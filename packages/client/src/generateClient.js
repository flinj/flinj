#!/usr/bin/env node
import path from 'path';
import fs from 'fs/promises';
import { createFolder, removeDir, getFileList } from '@flinj/utils';

/**
 *
 * @param {object} controllers
 * @returns { file: string, declarationFile: string }
 */
function generateClientFile(controllers) {
	const methodsWithData = ['POST', 'PUT', 'PATCH'];

	let file = `import axios from 'axios';`;
	file += 'export function createClient(config){';
	file += 'const instance = axios.create(config);';
	file += 'instance.interceptors.response.use(({ data }) => data);';
	file += 'return {';
	let declarationFile = `import type { CreateAxiosDefaults, AxiosRequestConfig } from 'axios';`;
	declarationFile += 'declare function createClient(config?: CreateAxiosDefaults): { ';

	write(controllers);
	function write(input, path = []) {
		for (const key in input) {
			const value = input[key];

			let currentPath = [...path];
			if (value === null) {
				const [method, ...restFunctionName] = key.split('_');
				file += generateControllerFunctionString(key, method, [...currentPath, ...restFunctionName]);
				declarationFile += generateControllerFunctionDeclarationString(key, method, [...currentPath, ...restFunctionName]);
			} else {
				file += `'${key}': {`;
				declarationFile += `'${key}': {`;
				currentPath.push(key);
				write(value, currentPath);
				file += '},';
				declarationFile += '};';
			}
		}
	}

	declarationFile += `}`;
	file += '}}';

	return { file, declarationFile };

	function generateControllerFunctionString(key, method, path) {
		const route = generateRoutePath(path);
		return `${key}(${generateArgs(true).join(',')}){ return instance.${method.toLocaleLowerCase()}(${route}, ${generateArgs().join(',')})},`;

		function generateRoutePath(path) {
			let output = '`/';
			const mappedList = path.map(str => {
				if (str.includes('$')) {
					return '${' + str.slice(1) + '}';
				}
				return str;
			});

			output += mappedList.join('/');
			output += '`';
			return output;
		}

		function generateArgs(includeDynamicArgs) {
			const args = [];

			if (includeDynamicArgs) {
				for (const item of path) {
					if (!item.includes('$')) continue;
					args.push(item.slice(1));
				}
			}

			if (methodsWithData.includes(method)) {
				args.push('data');
			}

			args.push('config');
			return args;
		}
	}

	function generateControllerFunctionDeclarationString(key, method, path) {
		return `${key}(${generateArgs().join(',')}): Promise<unknown>;`;

		function generateArgs() {
			const args = [];

			for (const item of path) {
				if (!item.includes('$')) continue;
				args.push(`${item.slice(1)}: string | number`);
			}

			if (methodsWithData.includes(method)) {
				args.push('data: { [key: string]: any }');
			}

			args.push('config?: AxiosRequestConfig');
			return args;
		}
	}
}

async function generateControllersObject(fileList, controllersDir) {
	const output = {};

	const promises = fileList.map(path => fs.readFile(path, 'utf-8'));

	const resolvedFiles = await Promise.all(promises);

	// TODO: support arrow function
	const regex = /^export (?:async )?function ((?:GET|POST|PUT|PATCH|DELETE)(?:_[$\w]*)?)\([.\w$,[\]{}:=\s]*\)*\s*{/gm;
	fileList.forEach((path, i) => {
		const pathParts = getPathParts(path);
		const scopedOutput = pathParts.reduce((acc, key) => (acc[key] = Object.assign(acc[key] ?? {})), output);

		const raw = resolvedFiles[i];
		let match;

		while ((match = regex.exec(raw))) {
			const functionName = match[1];
			scopedOutput[functionName] = null;
		}
	});

	return output;

	/**
	 *
	 * @param {string} path
	 * @returns {Array<string>}
	 */
	function getPathParts(path) {
		let output = path.slice(controllersDir.length + 1, -3);
		if (output.endsWith('index')) output = output.slice(0, -6);
		return output.split('/');
	}
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
	const [controllerFileList] = await getAllFileList(controllersDir);
	// TODO: throw error if no controllers

	const controllers = await generateControllersObject(controllerFileList, controllersDir);
	const { file, declarationFile } = generateClientFile(controllers);

	fs.writeFile(hiddenFolder + '/client.js', file);
	fs.writeFile(hiddenFolder + '/client.d.ts', declarationFile);
}

async function getAllFileList(...paths) {
	return Promise.all(paths.map(path => getFileList(path + '/**/*.js')));
}

generate(process.argv[2]);
