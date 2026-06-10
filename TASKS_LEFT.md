# What's Left

- Add typed examples for `PrismaClient` delegates (documentation / example project).
- Formalize query AST: normalize `IQueryOptions` into an internal AST type before compiling to SQL, so the compilation pipeline is independently testable.
- Add query depth / cost controls for deeply nested `children` filters before exposing advanced query endpoints publicly.
