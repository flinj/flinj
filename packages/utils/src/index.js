import fs from 'fs/promises';
import fastGlob from 'fast-glob';

export async function removeDir(path) {
	return fs.rm(path, { recursive: true }).catch(() => {});
}

export async function createFolder(path) {
	return fs.mkdir(path).catch(() => {});
}

export async function isFolderExists(path) {
	return fs
		.stat(path)
		.then(() => true)
		.catch(() => false);
}

export async function generateControllersFileStructure(fileList) {
	const output = {};
	const promises = fileList.map(path => fs.readFile(path, 'utf-8'));
	const filesContent = await Promise.all(promises);

	// TODO: support arrow function
	const regex = /^export (?:async )?function ((?:GET|POST|PUT|PATCH|DELETE)(?:_[$\w]*)?)\([.\w$,[\]{}:=\s]*\)*\s*{/gm;
	fileList.forEach((path, i) => {
		const key = path.slice(path.lastIndexOf('/') + 1, -3);
		output[key] = {};

		const content = filesContent[i];
		let match;

		while ((match = regex.exec(content))) {
			const functionName = match[1];
			output[key][functionName] = null;
		}
	});

	return output;
}

export async function getFileList(path) {
	return fastGlob(path);
}
