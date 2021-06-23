/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { Connection } from 'vscode-languageserver/node';
import { DocumentValidator } from '../lsp/validation/document-validator';
import { LangiumParser } from '../parser/langium-parser';
import { ScopeComputation } from '../references/scope';
import { LangiumServices } from '../services';
import { LangiumDocument, ProcessedLangiumDocument } from './document';

export interface DocumentBuilder {
    build(document: LangiumDocument): ProcessedLangiumDocument
}

export class DefaultDocumentBuilder implements DocumentBuilder {
    protected readonly connection?: Connection;
    protected readonly parser: LangiumParser;
    protected readonly scopeComputation: ScopeComputation;
    protected readonly documentValidator: DocumentValidator;

    constructor(services: LangiumServices) {
        this.connection = services.languageServer.Connection;
        this.parser = services.Parser;
        this.scopeComputation = services.references.ScopeComputation;
        this.documentValidator = services.validation.DocumentValidator;
    }

    build(document: LangiumDocument): ProcessedLangiumDocument {
        const parseResult = this.parser.parse(document);
        document.parseResult = parseResult;
        document.precomputedScopes = this.scopeComputation.computeScope(parseResult.value);
        const processed = document as ProcessedLangiumDocument;
        const diagnostics = this.documentValidator.validateDocument(processed);

        if (this.connection) {
            // Send the computed diagnostics to VS Code.
            this.connection.sendDiagnostics({ uri: document.uri, diagnostics });
        }
        return processed;
    }

}
