/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import fs from 'fs';
import _ from 'lodash';
import { CompositeGeneratorNode, IndentNode, NL, processGeneratorNode } from 'langium';
import { AbstractElement, Domainmodel, Entity, Feature, isEntity, isPackageDeclaration, Type } from '../language-server/generated/ast';
import path from 'path';

export function generateJava(domainmodel: Domainmodel, fileName: string, destination?: string): string {
    fileName = fileName.replace(/\..*$/, '').replace(/[.-]/g, '');
    const filePath = path.basename(fileName);

    return generateAbstractElements(destination ?? `./${path.dirname(fileName)}/generated`, domainmodel.elements, filePath);
}

function generateAbstractElements(destination: string, elements: Array<AbstractElement | Type>, filePath: string): string {

    function generateAbstractElementsInternal(elements: Array<AbstractElement | Type>, filePath: string): string {
        const fullPath = path.join(destination, filePath);
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        }

        const packagePath = filePath.replace(/\//g, '.').replace(/^\.+/, '');
        for (const elem of elements) {
            if (isPackageDeclaration(elem)) {
                generateAbstractElementsInternal(elem.elements, path.join(filePath, elem.name.replace(/\./g, '/')));
            } else if (isEntity(elem)) {
                const fileNode = new CompositeGeneratorNode();
                fileNode.append(`package ${packagePath};`, NL, NL);
                generateEntity(elem, fileNode);
                fs.writeFileSync(path.join(fullPath, `${elem.name}.java`), processGeneratorNode(fileNode));
            }
        }
        return fullPath;
    }

    return generateAbstractElementsInternal(elements, filePath);
}

function generateEntity(entity: Entity, fileNode: CompositeGeneratorNode): void {
    const maybeExtends = entity.superType ? ` extends ${entity.superType.$refName}` : '';
    fileNode.append(`class ${entity.name}${maybeExtends} {`, NL);
    fileNode.indent(classBody => {
        const featureData = entity.features.map(f => generateFeature(f, classBody));
        featureData.forEach(([generateField, , ]) => generateField());
        featureData.forEach(([, generateSetter, generateGetter]) => { generateSetter(); generateGetter(); } );
    });
    fileNode.append('}', NL);
}

function generateFeature(feature: Feature, classBody: IndentNode): [() => void, () => void, () => void] {
    const name = feature.name;
    const type = feature.type.$refName + (feature.many ? '[]' : '');

    return [
        () => { // generate the field
            classBody.append(`private ${type} ${name};`, NL);
        },
        () => { // generate the setter
            classBody.append(NL);
            classBody.append(`public void set${_.upperFirst(name)}(${type} ${name}) {`, NL);
            classBody.indent(methodBody => {
                methodBody.append(`this.${name} = ${name};`, NL);
            });
            classBody.append('}', NL);
        },
        () => { // generate the getter
            classBody.append(NL);
            classBody.append(`public ${type} get${_.upperFirst(name)}() {`, NL);
            classBody.indent(methodBody => {
                methodBody.append(`return ${name};`, NL);
            });
            classBody.append('}', NL);
        }
    ];
}