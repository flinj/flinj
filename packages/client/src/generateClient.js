#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createFolder, generateControllersFileStructure, removeDir, getFileList } from '@flinj/utils';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

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

function generateClientFile(controllersStructure) {
	let file = `import axios from 'axios';\n`;
	file += `/** @param {import('axios').CreateAxiosDefaults} config */\n`;
	file += 'export function createClient(config){';
	file += 'const instance = axios.create(config);';
	file += 'instance.interceptors.response.use(({ data }) => data);';
	file += 'return {';

	for (const namespace in controllersStructure) {
		file += `'${namespace}': {`;
		for (const functionName in controllersStructure[namespace]) {
			file += generateControllerFunctionString(namespace, functionName);
		}
		file += `},`;
	}

	file += '}}';

	return file;
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
	const clientFile = generateClientFile(controllersStructure);

	await fs.writeFile(hiddenFolder + '/client.js', clientFile);
}

generate(process.argv[2]);
