import { createFolder, generateControllersFileStructure, isFolderExists, getFileList } from '@flinj/utils';
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

function getValue(object, key) {
	const keyParts = key.split('.');

	let value = object;
	for (const key of keyParts) {
		if (value === undefined || value === null) return;
		value = value[key];
	}

	return value;
}

function getPath(...paths) {
	const rootDir = process.cwd();
	return paths.map(path => join(rootDir, path));
}

function parseRoutesObject(input, result = { '*': 'string' }, path) {
	for (const key in input) {
		const value = input[key];
		if (value === null) {
			result[`${path}/${key}`] = 'string';
		} else if (typeof value === 'object') {
			result[`${key}/*`] = 'string';
			parseRoutesObject(value, result, key);
		}
	}

	return result;
}

async function generateRouteType(input) {
	const object = parseRoutesObject(input);
	const hiddenFolder = './.flinj';
	if (!(await isFolderExists(hiddenFolder))) {
		await createFolder(hiddenFolder);
	}

	const unionType = Object.keys(object)
		.map(item => `'${item}'`)
		.join('|');
	const data = `export type Route = ${unionType};`;
	await fs.writeFile(hiddenFolder + '/route.d.ts', data);
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
	return Promise.all(paths.map(path => getFileList(path + '/*.js')));
}

function createMiddlewaresMap(middlewares) {
	const middlewaresMap = new Map();
	Object.entries(middlewares).forEach(([_, { default: handler, use }]) => {
		if (!use?.length) return;
		use.forEach(route => {
			if (middlewaresMap.has(route)) {
				middlewaresMap.get(route).push(handler);
			} else {
				middlewaresMap.set(route, [middlewareWrapper(handler)]);
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

function generateRoutes({ controllersFileStructure, controllers, middlewares }) {
	const middlewaresMap = createMiddlewaresMap(middlewares);

	const routes = [];
	// TODO: needs refactor
	Object.entries(controllersFileStructure).forEach(([rootPath, controllersObject]) => {
		Object.entries(controllersObject).forEach(([controllerKey]) => {
			const [_method, _name = ''] = controllerKey.split('_');
			const method = _method.toLocaleLowerCase();
			const name = _name?.replace('$', ':');
			const handler = getValue(controllers, `${rootPath}.${controllerKey}`);

			const route = '/' + [rootPath, name].filter(Boolean).join('/');

			// TODO: needs refactor
			const matchMiddlewareKeys = ['*', `${rootPath}/*`, `${rootPath}/${controllerKey}`];
			const allMiddlewares = matchMiddlewareKeys.filter(key => middlewaresMap.has(key)).flatMap(key => middlewaresMap.get(key));
			const middlewares = [...new Set(allMiddlewares)];

			routes.push({
				method,
				route,
				middlewares,
				handler: controllerWrapper(handler),
			});
		});
	});

	return routes;
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
	let { controllersDir, middlewaresDir } = options;
	[controllersDir, middlewaresDir] = getPath(controllersDir, middlewaresDir);

	// TODO: support multiple folder nesting
	const [controllerFileList, middlewareFileList] = await getAllFileList(controllersDir, middlewaresDir);
	const [controllers, middlewares] = await resolveFiles(controllerFileList, middlewareFileList);

	const controllersFileStructure = await generateControllersFileStructure(controllerFileList);
	generateRouteType(controllersFileStructure);

	const routes = generateRoutes({ controllersFileStructure, controllers, middlewares });
	const app = express();

	return {
		addMiddleware(...middlewares) {
			middlewares.forEach(middleware => app.use(middleware));
			return this;
		},
		start(port) {
			this.addMiddleware(...getDefaultMiddlewares());
			registerRoutes(routes);
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

	function registerRoutes(routes) {
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

	return res.status(status).json({ message });
}

/**
 *
 * @param {number} status
 * @param {string} body
 * @returns {AppError}
 */
export function error(status, body) {
	return new AppError(status, body);
}
