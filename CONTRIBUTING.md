# Contributing

## Reporting Issues

If you have found what you think is a bug, please [start a discussion](https://github.com/pmndrs/jotai/discussions/new).

For any usage questions, please [start a discussion](https://github.com/pmndrs/jotai/discussions/new).

## Suggesting new features

If you are here to suggest a feature, first [start a discussion](https://github.com/pmndrs/jotai/discussions/new) if it does not already exist. From there, we will discuss use-cases for the feature and then finally discuss how it could be implemented.

## Development guide

If you would like to contribute by fixing an open issue or developing a new feature you can use this suggested workflow:

### General

1. Fork this repository
2. Create a new feature branch based off the `main` branch
3. Follow the [Core](#Core) and/or the [Documentation](#Documentation) guide below and come back to this once done
4. Run `pnpm run fix:format` to format the code
5. Git stage your required changes and commit (review the commit guidelines below)
6. Submit the PR for review

#### Core

1. Install dependencies by running `pnpm install`.
2. Create failing tests for your fix or new feature in the [`tests`](./tests/) folder. (e.g., `cd tests`)
3. Implement your changes
4. Build the library by running `pnpm run build` _(Pro-tip: `pnpm run build-watch` runs the build in watch mode)_
5. Run the tests by running `pnpm run test` and ensure that they pass.
6. You can use `pnpm link` to sym-link this package and test it locally on your own project. Alternatively, you may use CodeSandbox CI's canary releases to test the changes in your own project (requires a PR to be created first)
7. Follow step 4 and onwards from the [General](#General) guide above to bring it to the finish line

#### Documentation

1. Navigate to the [`website`](./website/) folder. (e.g., `cd website`)
2. Install dependencies by running `pnpm install` in the `website` folder
3. Run `pnpm run dev` to start the dev server
4. Navigate to [`http://localhost:9000`](http://localhost:9000) to view the documents
5. Navigate to the [`docs`](./docs/) folder and make necessary changes to the documents. (e.g., `cd docs`)
6. Add your changes to the documents and see them live reloaded in the browser
7. Follow step 4 and onwards from the [General](#General) guide above to bring it to the finish line

### Committing

We are applying [conventional commit spec](https://www.conventionalcommits.org/en/v1.0.0/) here. In short, that means a commit has to be one of the following types:

Your commit type must be one of the following:

- **feat**: A new feature.
- **fix**: A bug fix.
- **refactor**: A code change that neither fixes a bug nor adds a feature.
- **chore**: Changes to the build process, configuration, dependencies, CI/CD pipelines, or other auxiliary tools and libraries.
- **docs**: Documentation-only changes.
- **test**: Adding missing or correcting existing tests.
- **style**: Changes that do not affect the meaning of the code (e.g., formatting, whitespace, missing semicolons).

If you are unfamiliar with the usage of conventional commits,
the short version is to simply specify the type as a first word,
and follow it with a colon and a space, then start your message
from a lowercase letter, like this:

```
feat: add a 'atomWithStorage' type support
```

You can also specify the scope of the commit in the parentheses after a type:

```
fix(react): change the 'useAtom' parameter type
```

## Pull requests

Please try to keep your pull request focused in scope and avoid including unrelated commits.

After you have submitted your pull request, we'll try to get back to you as soon as possible. We may suggest some changes or request improvements, therefore, please check ✅ ["Allow edits from maintainers"](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request-from-a-fork) on your PR

Thank you for contributing! :heart:
