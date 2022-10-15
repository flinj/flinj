# @flinj/client

| :construction: This project is still in development. You should use it with caution. |
| ------------------------------------------------------------------------------------ |

The fasest way to build REST API

![Flinching](https://media.giphy.com/media/TpXiNmXLdpOaEENYci/giphy.gif)

## Prerequisite

Install [@flinj/server](https://www.npmjs.com/package/@flinj/server) on your server

## Installation

```bash
npm i @flinj/client
```

navigate to your client directory and run

```base
npx flinj ../relative/path/to/backend/controllers
```

**Remember**
Everytime you create new controller on your server you need to run the command above

## Usage

```js
import { createClient } from '@flinj/client';

export const client = createClient({
	baseURL: '/api',
	headers: {
		authorization: `Bearer ${process.env.API_KEY}`,
	},
});

const user = await client.users.POST({
	name: 'Israel',
	email: 'test@gmail.com',
	password: '123456',
});
```

## TODO

- [x] support multi request params
- [x] adjust to work with the new changes of @flinj/server
