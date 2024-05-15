/******************************************************************************
 * This file was generated by langium-cli 3.0.3.
 * DO NOT EDIT MANUALLY!
 ******************************************************************************/

import type { LangiumSharedCoreServices, LangiumCoreServices, LangiumGeneratedCoreServices, LangiumGeneratedSharedCoreServices, LanguageMetaData, Module, IParserConfig } from 'langium';
import { DomainModelAstReflection } from './ast.js';
import { DomainModelGrammar } from './grammar.js';

export const DomainModelLanguageMetaData = {
    languageId: 'domain-model',
    fileExtensions: ['.dmodel'],
    caseInsensitive: false
} as const satisfies LanguageMetaData;

export const parserConfig: IParserConfig = {
    recoveryEnabled: true,
    nodeLocationTracking: 'full',
    maxLookahead: 3,
};

export const DomainModelGeneratedSharedModule: Module<LangiumSharedCoreServices, LangiumGeneratedSharedCoreServices> = {
    AstReflection: () => new DomainModelAstReflection()
};

export const DomainModelGeneratedModule: Module<LangiumCoreServices, LangiumGeneratedCoreServices> = {
    Grammar: () => DomainModelGrammar(),
    LanguageMetaData: () => DomainModelLanguageMetaData,
    parser: {
        ParserConfig: () => parserConfig
    }
};
