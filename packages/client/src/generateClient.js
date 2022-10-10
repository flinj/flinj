#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createFolder, generateControllersFileStructure, removeDir, getFileList } from '@flinj/utils';

/** @param {string} name */
function getDynamicArg(name) {
	const index = name.indexOf('$');
	if (index < 0) return;
	return name.slice(index + 1);
}

/**
 *
 * @param {string} namespace
 * @param {string} functionName
 * @returns {string}
 */
function generateControllerFunctionString(namespace, functionName) {
	const [method, name = ''] = functionName.split('_');

	function generateArgs() {
		const args = [];
		const dynamicArg = getDynamicArg(name);

		if (dynamicArg) {
			args.push(dynamicArg);
		}

		const methodsWithData = ['POST', 'PUT', 'PATCH'];
		if (methodsWithData.includes(method)) {
			args.push('data');
		}

		args.push('config');
		return args;
	}

	function generateBody() {
		let output = '{';
		output += `return instance.${method.toLocaleLowerCase()}(\`/${namespace}`;

		const dynamicArg = getDynamicArg(name);

		if (name) {
			output += '/' + (dynamicArg ? `\${${dynamicArg}}` : name);
		}
		output += '`, ';

		const args = generateArgs();
		if (dynamicArg) {
			args.splice(0, 1);
		}

		output += args.join(',');
		output += ')},';

		return output;
	}

	return `${functionName}` + `(${generateArgs().join(',')})` + generateBody();
}

/**
 *
 * @param {string} functionName
 * @returns {string}
 */
function generateControllerFunctionDeclarationString(functionName) {
	const [method, name = ''] = functionName.split('_');

	function generateArgs() {
		const args = [];
		const dynamicArg = getDynamicArg(name);

		if (dynamicArg) {
			args.push(`${dynamicArg}: string | number`);
		}

		const methodsWithData = ['POST', 'PUT', 'PATCH'];
		if (methodsWithData.includes(method)) {
			args.push('data: { [key: string]: any }');
		}

		args.push('config?: AxiosRequestConfig');
		return args;
	}

	return `${functionName}` + `(${generateArgs().join(',')}): Promise<unknown>;`;
}

/**
 *
 * @param {object} controllersStructure
 * @returns { file: string, declarationFile: string }
 */
function generateClientFile(controllersStructure) {
	let file = `import axios from 'axios';`;
	file += 'export function createClient(config){';
	file += 'const instance = axios.create(config);';
	file += 'instance.interceptors.response.use(({ data }) => data);';
	file += 'return {';
	let declarationFile = `import type { CreateAxiosDefaults, AxiosRequestConfig } from 'axios';`;
	declarationFile += 'declare function createClient(config?: CreateAxiosDefaults): { ';

	for (const namespace in controllersStructure) {
		file += `'${namespace}': {`;
		declarationFile += `'${namespace}': {`;
		for (const functionName in controllersStructure[namespace]) {
			file += generateControllerFunctionString(namespace, functionName);
			declarationFile += generateControllerFunctionDeclarationString(functionName);
		}
		declarationFile += `};`;
		file += `},`;
	}

	declarationFile += `}`;
	file += '}}';

	return { file, declarationFile };
}

/**
 *
 * @param {string} backendControllersDir
 * @returns
 */
async function generate(backendControllersDir) {
	if (!backendControllersDir) {
		throw new Error("you must provide the backend controllers dir, try to run 'npx flinj ../relative/path/to/backend/controllers'");
	}
	const hiddenFolder = path.resolve(process.cwd(), './.flinj');
	await removeDir(hiddenFolder);
	await createFolder(hiddenFolder);

	const controllersDir = path.resolve(process.cwd(), backendControllersDir);
	const controllerFileList = await getFileList(`${controllersDir}/*.js`);
	// TODO: throw error if no controllers

	const controllersStructure = await generateControllersFileStructure(controllerFileList);
	const { file, declarationFile } = generateClientFile(controllersStructure);

	fs.writeFile(hiddenFolder + '/client.js', file);
	fs.writeFile(hiddenFolder + '/client.d.ts', declarationFile);
}

generate(process.argv[2]);
