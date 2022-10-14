import { createFolder, isFolderExists, getFileList } from '@flinj/utils';
import { join } from 'path';
import express from 'express';
import fs from 'fs/promises';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import AppError from './AppError.js';

/**
 * @typedef {{ start: (port: number) => void, addMiddleware: (...middlewares: function[]) => CreateApp }} CreateApp
 * @typedef {import('../../../../.flinj/route').Route[]} Routes
 * @typedef {(name: string, value: string, options: express.CookieOptions) => void} SetCookie
 * @typedef {(object: ObjectWithAnyStrings) => void} SetHeaders
 * @typedef {Object.<string, string>} ObjectWithAnyStrings
 * @typedef {Object.<string, any>} ObjectWithAnyValues
 * @typedef {(ctx: { body: ObjectWithAnyValues, url: URL, params: ObjectWithAnyStrings, query: ObjectWithAnyStrings, cookies: ObjectWithAnyStrings, stuff: ObjectWithAnyValues, setCookie: SetCookie, setHeaders: SetHeaders }) => any} Controller
 */

function getPath(...paths) {
	const rootDir = process.cwd();
	return paths.map(path => join(rootDir, path));
}

async function generateRouteType(input) {
	const hiddenFolder = './.flinj';
	if (!(await isFolderExists(hiddenFolder))) {
		await createFolder(hiddenFolder);
	}

	const keys = ["'*'"];
	writeTypes(input);

	const data = `export type Route = ${keys.join('|')};`;
	await fs.writeFile(hiddenFolder + '/route.d.ts', data);

	function writeTypes(input, path = []) {
		for (const key in input) {
			const value = input[key];
			const currentPath = [...path];
			if (typeof value === 'object') {
				currentPath.push(key);
				keys.push(`'${currentPath.join('/')}/*'`);
				writeTypes(value, currentPath);
			} else {
				keys.push(`'${currentPath.join('/')}/${key}'`);
			}
		}
	}
}

async function resolveFiles(...paths) {
	return Promise.all(
		paths.map(async pathList => {
			const resolvedModules = await Promise.all(pathList.map(path => import(path)));
			return pathList.reduce((acc, path, i) => {
				const key = path.slice(path.lastIndexOf('/') + 1, -3);
				acc[key] = resolvedModules[i];
				return acc;
			}, {});
		})
	);
}

async function getAllFileList(...paths) {
	return Promise.all(paths.map(path => getFileList(path + '/**/*.js')));
}

function createMiddlewaresMap(middlewares) {
	const middlewaresMap = new Map();
	Object.entries(middlewares).forEach(([_, { default: handler, use }]) => {
		if (!use?.length) return;
		use.forEach(route => {
			if (middlewaresMap.has(route)) {
				middlewaresMap.get(route).push(handler);
			} else {
				middlewaresMap.set(route, [handler]);
			}
		});
	});
	return middlewaresMap;
}

/**
 *
 * @param {express.Request} req
 * @param {express.Response} res
 * @returns
 */
function createCtx(req, res) {
	if (!req.stuff) {
		req.stuff = {};
	}
	const { body, params, query, cookies, _parsedUrl, stuff } = req;
	// TODO: think about adding METHOD

	/** @type {SetCookie} */
	function setCookie(name, value, options) {
		res.cookie(name, value, options);
	}

	/** @type {SetHeaders} */
	function setHeaders(headers) {
		res.set(headers);
	}

	return { body, url: _parsedUrl, params, query, cookies, stuff, setCookie, setHeaders };
}

function controllerWrapper(handler) {
	return async (req, res, next) => {
		try {
			let status = 200;
			const response = await handler(createCtx(req, res));
			if (response == null) status = 204;

			return res.status(status).json(response);
		} catch (err) {
			next(err);
		}
	};
}

function middlewareWrapper(handler) {
	return async (req, res, next) => {
		try {
			await handler(createCtx(req, res));
			next();
		} catch (err) {
			next(err);
		}
	};
}

function generateRoutes({ controllers, middlewares }) {
	const middlewaresMap = createMiddlewaresMap(middlewares);

	const routes = [];
	writeRoutes(controllers);

	return routes;

	function writeRoutes(object, path = []) {
		for (const key in object) {
			const value = object[key];
			const currentPath = [...path];
			if (typeof value === 'object') {
				currentPath.push(key);
				writeRoutes(value, currentPath);
			} else {
				const [method, ...restFunctionName] = key.split('_');
				const route = generateRoutePath([...currentPath, ...restFunctionName]);

				const matchMiddlewareKeys = getMatchMiddlewareKeys();
				const allMiddlewares = matchMiddlewareKeys.filter(key => middlewaresMap.has(key)).flatMap(key => middlewaresMap.get(key));
				const middlewares = getUniqueMiddlewares();

				routes.push({
					method: method.toLocaleLowerCase(),
					route,
					middlewares,
					handler: controllerWrapper(value),
				});

				function getMatchMiddlewareKeys() {
					const matches = ['*'];

					currentPath.forEach((_, i) => {
						const list = currentPath.slice(0, i + 1);
						matches.push(list.join('/') + '/*');
					});

					matches.push([...currentPath, key].join('/'));
					return matches;
				}

				function getUniqueMiddlewares() {
					const map = new Map();
					const functionsAsStrings = allMiddlewares.map(fn => fn.toString());
					functionsAsStrings.forEach((fnString, i) => {
						if (map.has(fnString)) return;
						map.set(fnString, i);
					});

					return Array.from(map.values()).map(i => middlewareWrapper(allMiddlewares[i]));
				}
			}
		}
	}

	/** @param {Array<string>} list */
	function generateRoutePath(list) {
		return '/' + list.map(str => str.replace('$', ':')).join('/');
	}
}

// TOOD: shift logic to utils
async function generateControllersObject(fileList, controllersDir) {
	const output = {};

	const promises = fileList.map(async path => {
		const [raw, parsed] = await Promise.all([fs.readFile(path, 'utf-8'), import(path)]);
		return { raw, parsed };
	});

	const resolvedFiles = await Promise.all(promises);

	// TODO: support arrow function
	const regex = /^export (?:async )?function ((?:GET|POST|PUT|PATCH|DELETE)(?:_[$\w]*)?)\([.\w$,[\]{}:=\s]*\)*\s*{/gm;
	fileList.forEach((path, i) => {
		const pathParts = getPathParts(path);
		const scopedOutput = pathParts.reduce((acc, key) => (acc[key] = Object.assign(acc[key] ?? {})), output);

		const { raw, parsed } = resolvedFiles[i];
		let match;

		while ((match = regex.exec(raw))) {
			const functionName = match[1];
			scopedOutput[functionName] = parsed[functionName];
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
 * @param {{ controllersDir: string, middlewaresDir: string, debug: boolean }} options
 * @returns {Promise<CreateApp>}
 */
export async function createApp(
	options = {
		debug: false,
	}
) {
	// TODO: export dir values to config file
	let { controllersDir, middlewaresDir } = options;
	[controllersDir, middlewaresDir] = getPath(controllersDir, middlewaresDir);

	const [controllerFileList, middlewareFileList] = await getAllFileList(controllersDir, middlewaresDir);
	// TODO: refactor here, not need to await for both
	const [middlewares] = await resolveFiles(middlewareFileList);
	const controllers = await generateControllersObject(controllerFileList, controllersDir);

	generateRouteType(controllers);

	const routes = generateRoutes({ controllers, middlewares });
	const app = express();

	return {
		addMiddleware(...middlewares) {
			middlewares.forEach(middleware => app.use(middleware));
			return this;
		},
		start(port) {
			this.addMiddleware(...getDefaultMiddlewares());
			registerRoutes();
			applyErrorHandlers();
			app.listen(port, () => console.log(`listening at http://localhost:${port}`));
		},
	};

	function registerRoute({ method, route, middlewares, handler }) {
		if (options.debug) {
			// TODO: show the registered middlewares somehow
			console.log(`${method.toUpperCase()} ${route}`);
		}

		app[method](route, ...middlewares, handler);
	}

	function registerRoutes() {
		routes.forEach(registerRoute);
	}

	function applyErrorHandlers() {
		app.all('*', notFoundErrorHandler);
		app.use(globalErrorHandler);
	}

	function getDefaultMiddlewares() {
		return [express.json(), cookieParser(), helmet()];
	}
}

function notFoundErrorHandler(req, res, next) {
	return next(error(404, `Can't find ${req.originalUrl} on this server!`));
}

function globalErrorHandler(err, req, res, next) {
	const { isOperational } = err;
	let { message, status = 500 } = err;
	if (!isOperational) {
		console.log(err);
		status = 500;
		message = 'Something went wrong!';
	}

	res.status(status);

	if (message) {
		res.json({ message });
	} else {
		res.send();
	}
}

/**
 *
 * @param {number} status
 * @param {string=} body
 * @returns {AppError}
 */
export function error(status, body) {
	return new AppError(status, body);
}
