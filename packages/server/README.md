# @flinj/server

| :construction: This project is still in development. You should use it with caution. |
| ------------------------------------------------------------------------------------ |

The fasest way to build REST API

![Flinching](https://media.giphy.com/media/TpXiNmXLdpOaEENYci/giphy.gif)

## Installation

```bash
npm i @flinj/server
```

## Usage

```js
import { createApp } from '@flinj/server';
// import morgan from 'morgan';

const app = await createApp({
	controllersDir: '/path/to/controllers',
	middlewaresDir: '/path/to/middlewares',
	debug: true, // to see which routes were registered
});

// app.addMiddleware(morgan('tiny'));

app.start(3000);
```

```js
// /path/to/controllers/auth.js

/** @type {import('@flinj/server').Controller} */
export function GET(ctx) {
	const { firstName, lastName } = ctx.query;

	return { message: `Hello ${firstName} ${lastName}!` };
}

/** @type {import('@flinj/server').Controller} */
export async function POST(ctx) {
	const { email, password } = ctx.body;

	await db.createUser({ email, password });
}

/** @type {import('@flinj/server').Controller} */
export async function POST_login(ctx) {
	const { email, password } = ctx.body;

	const user = await login(email, password);
	ctx.setCookie('jwt', 'eyTOKEN', { httpOnly: true, secure: true, maxAge: 1000 * 60 * 60 * 24 * 3 });

	return user;
}

/** @type {import('@flinj/server').Controller} */
export async function DELETE_$id(ctx) {
	const { id } = ctx.params;

	await db.deleteUser(id);
}
```

```js
// /path/to/middlewares/auth.js

import { error } from '@flinj/server';

/** @type {import('@flinj/server').Controller} */
export default async ctx => {
	const { cookies } = ctx;

	const token = cookies?.jwt;
	ctx.setHeaders({
		'x-custom-header': 'x-custom',
	});

	try {
		const tokenResponse = await validateToken(token);
		ctx.stuff.auth = {
			userId: tokenResponse.userId,
		};
	} catch (err) {
		throw error(401, 'Unauthorized');
	}
};

/** @type {import('@flinj/server').Routes} */
export const use = ['auth/*'];
```

### You can define a single route in all the ways mentioned below

You can define as many route names/params as you want using the `underscore` symbol

```js
// Route: POST /projects/:projectId/settings/duplicate

// /projects.js
export function POST_$projectId_settings_duplicate() {}

// /projects/index.js
export function POST_$projectId_settings_duplicate() {}

// /projects/[projectId].js
export function POST_settings_duplicate() {}

// /projects/[projectId]/index.js
export function POST_settings_duplicate() {}

// /projects/[projectId]/settings.js
export function POST_duplicate() {}

// /projects/[projectId]/settings/index.js
export function POST_duplicate() {}

// /projects/[projectId]/settings/duplicate.js
export function POST() {}

// /projects/[projectId]/settings/duplicate/index.js
export function POST() {}
```

I know there are so many ways to write 1 route, but I found it the most flexible and each one will decide to sort it the way that makes most sense for him. and will add a feature that warn if a route declared more than once

## TOOD:

- [ ] add tests
- [ ] find a better way to generate routes
- [x] support unlimited dashed on function name
- [x] support nested folder strucutre for controllers i.e.
- [x] add documentation to the new changes
- [x] make the error message optional
