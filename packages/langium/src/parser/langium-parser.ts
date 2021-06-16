/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

/* eslint-disable @typescript-eslint/no-explicit-any */
import { EmbeddedActionsParser, ILexingError, IOrAlt, IRecognitionException, IToken, Lexer, TokenType } from 'chevrotain';
import { AbstractElement, Action, isAssignment, isCrossReference } from '../grammar/generated/ast';
import { LangiumDocument } from '../documents/document';
import { AstNode, Reference } from '../syntax-tree';
import { isArrayOperator } from '../grammar/grammar-util';
import { CstNodeBuilder } from './cst-node-builder';
import { GrammarAccess } from '../grammar/grammar-access';
import { Linker } from '../references/linker';
import { LangiumServices } from '../services';
import { getContainerOfType } from '../utils/ast-util';

type StackItem = {
    object: any,
    executedAction: boolean
}

export type ParseResult<T> = {
    value: T,
    parserErrors: IRecognitionException[],
    lexerErrors: ILexingError[]
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace String {
    export const type = 'String';
    export function is(item: unknown): boolean {
        return (item as any).$type === type;
    }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Number {
    export const type = 'Number';
    export function is(item: unknown): boolean {
        return (item as any).$type === type;
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RuleResult = (idxInCallingRule?: number, ...args: any[]) => any

export class LangiumParser {
    readonly grammarAccess: GrammarAccess;

    private readonly linker: Linker;
    private readonly lexer: Lexer;
    private readonly nodeBuilder = new CstNodeBuilder();
    private readonly wrapper: ChevrotainWrapper;
    private stack: StackItem[] = [];
    private mainRule!: RuleResult;

    private get current(): StackItem {
        return this.stack[this.stack.length - 1];
    }

    constructor(tokens: TokenType[], services: LangiumServices) {
        this.wrapper = new ChevrotainWrapper(tokens);
        this.grammarAccess = services.GrammarAccess;
        this.linker = services.references.Linker;
        this.lexer = new Lexer(tokens);
    }

    MAIN_RULE(
        name: string,
        type: string,
        implementation: () => unknown
    ): () => unknown {
        return this.mainRule = this.DEFINE_RULE(name, type, implementation);
    }

    DEFINE_RULE(
        name: string,
        type: string | undefined,
        implementation: () => unknown
    ): () => unknown {
        return this.wrapper.DEFINE_RULE(name, this.startImplementation(type, implementation).bind(this));
    }

    parse(input: string | LangiumDocument): ParseResult<AstNode> {
        this.wrapper.selfAnalysis();
        const text = typeof input === 'string' ? input : input.getText();
        this.nodeBuilder.buildRootNode(text);
        const lexerResult = this.lexer.tokenize(text);
        this.wrapper.input = lexerResult.tokens;
        const result = this.mainRule.call(this.wrapper);
        if (typeof input !== 'string') {
            result.$document = input;
        }
        return {
            value: result,
            lexerErrors: lexerResult.errors,
            parserErrors: this.wrapper.errors
        };
    }

    private startImplementation($type: string | undefined, implementation: () => unknown): () => unknown {
        return () => {
            if (!this.wrapper.IS_RECORDING) {
                this.stack.push({
                    object: { $type },
                    executedAction: false
                });
            }
            let result: unknown;
            try {
                result = implementation();
            } catch (err) {
                console.log('Parser exception thrown!', err);
                result = undefined;
            }
            if (!this.wrapper.IS_RECORDING && !result) {
                result = this.construct();
            }
            return result;
        };
    }

    or(idx: number, choices: Array<() => void>): void {
        this.wrapper.wrapOr(idx, choices);
    }

    option(idx: number, callback: () => void): void {
        this.wrapper.wrapOption(idx, callback);
    }

    many(idx: number, callback: () => void): void {
        this.wrapper.wrapMany(idx, callback);
    }

    consume(idx: number, tokenType: TokenType, feature: AbstractElement): void {
        const token = this.wrapper.wrapConsume(idx, tokenType);
        if (!this.wrapper.IS_RECORDING) {
            this.nodeBuilder.buildLeafNode(token, feature);
            const assignment = getContainerOfType(feature, isAssignment);
            if (assignment) {
                let crossRefId: string | undefined;
                if (isCrossReference(assignment.terminal)) {
                    crossRefId = `${this.current.object.$type}:${assignment.feature}`;
                }
                this.assign(assignment, token.image, crossRefId);
            }
        }
    }

    unassignedSubrule(idx: number, rule: RuleResult, feature: AbstractElement): void {
        const result = this.subrule(idx, rule, feature);
        if (!this.wrapper.IS_RECORDING) {
            const resultKind = result.$type;
            const object = Object.assign(result, this.current.object);
            if (resultKind) {
                (<any>object).$type = resultKind;
            }
            const newItem = { ...this.current, object };
            this.stack.pop();
            this.stack.push(newItem);
        }
    }

    subrule(idx: number, rule: RuleResult, feature: AbstractElement): any {
        if (!this.wrapper.IS_RECORDING) {
            this.nodeBuilder.buildCompositeNode(feature);
        }
        const subruleResult = this.wrapper.wrapSubrule(idx, rule);
        if (!this.wrapper.IS_RECORDING) {
            const assignment = getContainerOfType(feature, isAssignment);
            if (assignment) {
                this.assign(assignment, subruleResult);
            }
        }
        return subruleResult;
    }

    action($type: string, action: Action): void {
        if (!this.wrapper.IS_RECORDING && !this.current.executedAction) {
            const last = this.current;
            const newItem: StackItem = {
                object: { $type },
                executedAction: true
            };
            this.stack.pop();
            this.stack.push(newItem);
            if (action.feature && action.operator) {
                this.assign(action, last.object);
            }
        }
    }

    /**
     * Initializes array fields of the current object. Array fields are not allowed to be undefined.
     * Therefore, all array fields are initialized with an empty array.
     * @param grammarAccessElement The grammar access element that belongs to the current rule
     */
    initializeElement(grammarAccessElement: { [key: string]: AbstractElement }): void {
        if (!this.wrapper.IS_RECORDING) {
            // TODO fix this by inverting the assign call in unassignedSubrule
            //const item = this.current.object;
            for (const element of Object.values(grammarAccessElement)) {
                if (isAssignment(element)) {
                    if (isArrayOperator(element.operator)) {
                        //item[element.feature] = [];
                    }
                }
            }
        }
    }

    construct(): unknown {
        if (this.wrapper.IS_RECORDING) {
            return undefined;
        }
        const item = this.current;
        const obj = item.object;
        for (const [name, value] of Object.entries(obj)) {
            if (!name.startsWith('$')) {
                if (Array.isArray(value)) {
                    for (const item of value) {
                        if (item !== null && typeof item === 'object') {
                            item.$container = obj;
                        }
                    }
                } else if (item !== null && typeof (value) === 'object') {
                    (<any>value).$container = obj;
                }
            }
        }
        this.nodeBuilder.construct(obj);
        this.stack.pop();
        if (String.is(obj)) {
            const node = obj.$cstNode;
            return node.text;
        } else if (Number.is(obj)) {
            const node = obj.$cstNode;
            return parseFloat(<string>node.text);
        }
        return obj;
    }

    private assign(assignment: { operator: string, feature: string }, value: unknown, crossRefId?: string): void {
        const obj = this.current.object;
        const feature = assignment.feature.replace(/\^/g, '');
        const item = crossRefId && typeof value === 'string' ? this.buildReference(obj, value, crossRefId) : value;
        switch (assignment.operator) {
            case '=': {
                obj[feature] = item;
                break;
            }
            case '?=': {
                obj[feature] = true;
                break;
            }
            case '+=': {
                if (!Array.isArray(obj[feature])) {
                    obj[feature] = [];
                }
                obj[feature].push(item);
            }
        }
    }

    private buildReference(node: AstNode, text: string, crossRefId: string): Reference {
        const link = this.linker.link.bind(this.linker);
        const reference: Reference & { _ref?: AstNode } = {
            $refName: text,
            get ref() {
                if (reference._ref === undefined) {
                    // TODO handle linking errors
                    reference._ref = link(node, text, crossRefId);
                }
                return reference._ref;
            }
        };
        return reference;
    }
}

/**
 * This class wraps the embedded actions parser of chevrotain and exposes protected methods.
 * This way, we can build the `LangiumParser` as a composition.
 */
class ChevrotainWrapper extends EmbeddedActionsParser {

    private analysed = false;

    constructor(tokens: TokenType[]) {
        super(tokens, { recoveryEnabled: true, nodeLocationTracking: 'onlyOffset' });
    }

    get IS_RECORDING(): boolean {
        return this.RECORDING_PHASE;
    }

    DEFINE_RULE(name: string, impl: () => unknown): () => unknown {
        return this.RULE(name, impl);
    }

    selfAnalysis(): void {
        if (!this.analysed) {
            this.performSelfAnalysis();
            this.analysed = true;
        }
    }

    wrapConsume(idx: number, tokenType: TokenType): IToken {
        return this.consume(idx, tokenType);
    }

    wrapSubrule(idx: number, rule: RuleResult): unknown {
        return this.subrule(idx, rule);
    }

    wrapOr(idx: number, choices: Array<() => void>): void {
        this.or(idx, choices.map(e => <IOrAlt<any>>{ ALT: e }));
    }

    wrapOption(idx: number, callback: () => void): void {
        this.option(idx, callback);
    }

    wrapMany(idx: number, callback: () => void): void {
        this.many(idx, callback);
    }
}