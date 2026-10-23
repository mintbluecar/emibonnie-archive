// Intentionally empty. @types/node's ambient declaration for the deprecated
// "node:punycode" core module re-exports from the bare "punycode" specifier
// (`export * from "punycode"`). Without this stub, Node-style module
// resolution prefers the real npm "punycode" package (a transitive
// devDependency of eslint, hoisted into node_modules) over the ambient
// @types/node declaration, and `checkJs` then type-checks that package's
// implementation file, which isn't typed for strict mode and isn't part of
// this project. This stub satisfies the re-export with an empty module so
// the real package is never loaded by tsc. See jsconfig.json's `paths`.
export {};
