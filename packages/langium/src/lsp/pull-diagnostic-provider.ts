/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { CancellationToken, DocumentDiagnosticParams, DocumentDiagnosticReport } from 'vscode-languageserver';
import type { LangiumDocument } from '../workspace/documents.js';
import type { AstNode } from '../syntax-tree.js';
import type { LangiumServices } from './lsp-services.js';
import type { DocumentValidator } from '../validation/document-validator.js';

/**
 * Language-specific service for providing document diagnostics upon client request.
 */
export interface PullDiagnosticProvider {
    /**
     * Returns all diagnostics for the given document.
     *
     * @param document for which to retrieve all diagnostics
     * @param diagnosticParams for the request: these include the last request ID.
     * @param cancelToken Indicates when to cancel the request.
     *
     * @throws `OperationCancelled` if cancellation is detected during execution
     * @throws `ResponseError` if an error is detected that should be sent as response to the client
     */
    getDocumentDiagnostics(document: LangiumDocument, diagnosticParams: DocumentDiagnosticParams, cancelToken?: CancellationToken): Promise<DocumentDiagnosticReport>;
}

/**
 * The default diagnostic provider uses:
 * 1. the language-specific DocumentValidator to retrieve all diagnostics and produce a full diagnostic report.
 */
export class DefaultPullDiagnosticProvider implements PullDiagnosticProvider {
    private validator: DocumentValidator;

    constructor(services: LangiumServices) {
        this.validator = services.validation.DocumentValidator;
    }

    async getDocumentDiagnostics(document: LangiumDocument<AstNode>, diagnosticParams: DocumentDiagnosticParams, cancelToken?: CancellationToken): Promise<DocumentDiagnosticReport> {
        const items = await this.validator.validateDocument(document, {}, cancelToken);
        return { kind: 'full', items };
    }
}