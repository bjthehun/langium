/******************************************************************************
 * Copyright 2024 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { CancellationToken, DocumentDiagnosticParams, DocumentDiagnosticReport, FullDocumentDiagnosticReport } from 'vscode-languageserver';
import type { LangiumDocument } from '../workspace/documents.js';
import { DocumentState } from '../workspace/documents.js';
import type { AstNode } from '../syntax-tree.js';
import type { LangiumSharedServices } from './lsp-services.js';
import type { URI } from '../utils/uri-utils.js';
import type { DocumentBuilder } from '../index.js';

/**
 * Shared service for providing document diagnostics upon client request.
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
 * The default diagnostic provider maintains diagnostic reports (capsuled diagnostics per document/URI).
 * It invalidates documents upon deletion/creation, and (re-)creates reports as demanded.
 */
export class DefaultPullDiagnosticProvider implements PullDiagnosticProvider {
    private nextId = 0;
    private builder: DocumentBuilder;
    private existingReports: Map<URI, FullDocumentDiagnosticReport> = new Map();

    constructor(services: LangiumSharedServices) {
        this.builder = services.workspace.DocumentBuilder;
        this.builder.onUpdate((changed, deleted) => {
            this.invalidate([...changed, ...deleted]);
        });
    }

    async getDocumentDiagnostics(document: LangiumDocument<AstNode>, diagnosticParams: DocumentDiagnosticParams, cancelToken?: CancellationToken): Promise<DocumentDiagnosticReport> {
        // Case 1: We have diagnostics available.
        let reportForDocument = this.existingReports.get(document.uri);
        if (reportForDocument) {
            // Case 1.1: Client's report is up to date; thus return unchanged diagnostics.
            if (diagnosticParams.previousResultId && diagnosticParams.previousResultId === reportForDocument.resultId) {
                return { kind: 'unchanged', resultId: diagnosticParams.previousResultId };
            }
            // Case 1.2: Client's report is out of date; thus return existing diagnostics.
            else {
                return reportForDocument;
            }
        }

        // Case 2: We have to wait for diagnostics. Create and store a new report, then.
        await this.builder.waitUntil(DocumentState.Validated, document.uri, cancelToken);
        const resultId = `${this.nextId}`;
        this.nextId++;
        reportForDocument = { kind: 'full', items: document.diagnostics!, resultId };
        this.existingReports.set(document.uri, reportForDocument);
        return reportForDocument;
    }

    private invalidate(invalidated: URI[]) {
        invalidated.forEach(uri => this.existingReports.delete(uri));
    }
}