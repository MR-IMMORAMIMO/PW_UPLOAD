# Coding Standards

## Naming

- Use camelCase for variables, functions, and parameters.
- Use PascalCased for classes, types, interfaces, and enums.
- Use UPPER_CASE for constants.
- Use descriptive names that convey intent.
- Avoid abbreviations unless they are widely understood (e.g., URL, HTML).
- Boolean variables should be prefixed with is, has, can, or should.
- Functions should be named with verbs or verb phrases.
- Name files after the primary class/function they contain (PascalCase.ts).
- Test files should follow the pattern: [name].test.ts.
- Use _ prefix for private properties that are accessed via getters/setters.

## Folder Conventions

- Group files by feature/domain, not by type.
- Keep related files close together.
- Use flat structures when possible; avoid deep nesting.
- Name folders using kebab-case.
- Place index files (index.ts) in directories for public exports.
- Separate public APIs from implementation details.
- Put interface definitions near their usage or in a shared types folder.
- Keep test files next to the files they test (**tests** or .test.ts suffix).
- Assets (images, styles) should be colocated with components that use them.
- Configuration files belong in config/ directory.
- Scripts belong in scripts/ directory.

## TypeScript Rules

- Enable strict mode in tsconfig.json.
- Avoid any; use unknown and type guards instead.
- Prefer interfaces for object shapes; use type aliases for unions/transforms.
- Make properties readonly by default unless mutation is needed.
- Use explicit return types for public API functions.
- Avoid namespace usage; prefer ES6 modules.
- Don't disable TS rules without documentation and approval.
- Use enums only for closed sets of constants; prefer union types when possible.
- Prefer const over let; let over var.
- Use arrow functions for lexical this binding.
- Prefer template literals over string concatenation.
- Destructure objects and arrays when appropriate.
- Never ignore return values of Promise-returning functions without comment.

## Error Handling

- Handle errors at the appropriate level; don't ignore them.
- Use try/catch for synchronous error handling.
- Return rejected promises for asynchronous errors.
- Create custom error types for domain-specific errors.
- Never throw strings or primitives; always throw Error objects.
- Wrap third-party calls in domain-specific error types.
- Log errors with sufficient context for debugging.
- User-facing errors should be localized and actionable.
- Distinguish between operational errors and programmer errors.
- Use either callbacks, promises, or async/await consistently within a module.
- Never leave try blocks empty.
- Clean up resources in finally blocks.

## Logging

- Use structured logging with consistent fields.
- Include correlation ID in all log entries.
- Log at appropriate levels: error, warn, info, debug, trace.
- Never log sensitive information (passwords, tokens, PII).
- Use logger factories to create category-specific loggers.
- Include timestamps in ISO 8601 format.
- Add contextual information (user ID, request ID, etc.).
- Rotate logs based on size and time.
- Retain logs according to compliance requirements.
- Use different log levels for development vs production.
- Don't use console.log in production code; use the logger abstraction.

## Async Patterns

- Prefer async/await over raw promises for readability.
- Always await promises or explicitly handle them with .then/.catch.
- Avoid mixing async/await and .then() in the same function.
- Use Promise.all for parallel independent operations.
- Use Promise.race for timeouts or racing conditions.
- Don't forget to handle promise rejections.
- Limit concurrent async operations to prevent resource exhaustion.
- Use proper cancellation tokens for long-running operations.
- Avoid fire-and-forget async operations without error handling.
- Implement retry logic with exponential backoff for transient failures.
- Use debouncing and throttling for rate-limited operations.

## Dependency Injection

- Depend on abstractions (interfaces), not concretions.
- Inject dependencies through constructors when possible.
- Use setter injection only for optional dependencies.
- Avoid service locator patterns.
- Make dependencies explicit in constructor signatures.
- Prefer constructor injection for mandatory dependencies.
- Use factory patterns for complex object creation.
- Keep constructors lightweight; avoid heavy lifting in constructors.
- Use dependency injection containers wisely; avoid over-reliance.
- Make services stateless when possible.
- Clearly define service lifetimes (singleton, scoped, transient).

## Validation

- Validate all input at the boundaries (API, UI, etc.).
- Use Zod for runtime validation of complex objects.
- Validate both syntactically and semantically.
- Return specific validation errors to help users correct input.
- Validate on both client and server for critical data.
- Never trust client-side validation alone for security.
- Use allowlists over blocklists for validation when possible.
- Sanitize input to prevent injection attacks.
- Validate file types, sizes, and content for uploads.
- Implement rate limiting to prevent abuse.
- Use CAPTCHAs or similar for high-risk operations.

## Service Boundaries

- Keep services focused on a single responsibility.
- Services should not know about web frameworks or UI details.
- Put business logic in domain services, not in controllers.
- Make services stateless when possible; manage state explicitly.
- Use events for inter-service communication when appropriate.
- Avoid circular dependencies between services.
- Hide implementation details behind interfaces.
- Version services when breaking changes are necessary.
- Document service contracts clearly.
- Handle service failures gracefully with fallbacks or circuit breakers.
- Monitor service performance and error rates.

## Testing Philosophy

- Write tests that verify behavior, not implementation.
- Test public APIs, not private methods.
- Use descriptive test names that explain the scenario.
- Arrange, Act, Assert (AAA) pattern for test structure.
- Test one thing per test case.
- Use meaningful assertions with clear failure messages.
- Mock external dependencies in unit tests.
- Use fake implementations for complex dependencies when appropriate.
- Test edge cases and error conditions.
- Keep tests fast and reliable; avoid sleep() in tests.
- Run tests in isolation; don't rely on test order.
- Measure and maintain test coverage over time.
- Treat test code with the same respect as production code.
- Write tests before or alongside implementation (TDD/BDD).
- Continuously review and refactor tests as code evolves.

## Documentation Expectations

- Comment the why, not the what.
- Keep comments close to the code they describe.
- Update comments when changing code.
- Use TODO comments with tracking information (owner, date).
- Use FIXME comments for known issues that need attention.
- Use XXX comments for hacky or temporary solutions.
- Document public APIs with JSDoc.
- Include parameter types, return types, and thrown exceptions.
- Describe complex algorithms with step-by-step comments.
- Link to external documentation or specifications when relevant.
- Keep documentation in sync with code changes.
- Use diagrams for complex interactions or data flows.
- Maintain a changelog for user-facing changes.
- Write documentation for your future self and teammates.
