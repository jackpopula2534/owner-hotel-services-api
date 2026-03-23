# TypeScript/NestJS Coding Style — Owner Hotel Services API

## Types and Interfaces

- Add explicit types to all service methods, controller endpoints, and DTOs
- Let TypeScript infer obvious local variable types
- Use `interface` for object shapes, `type` for unions/intersections
- Avoid `any` — use `unknown` with safe narrowing
- ใช้ class-validator decorators สำหรับ DTO validation

## NestJS Patterns

### Module Structure
```
modules/<feature>/
├── <feature>.module.ts       # Module definition
├── <feature>.controller.ts   # HTTP endpoints
├── <feature>.service.ts      # Business logic
├── dto/
│   ├── create-<feature>.dto.ts
│   └── update-<feature>.dto.ts
└── entities/                 # Prisma types or custom entities
```

### Controller Pattern
- ใช้ Swagger decorators สำหรับ API documentation
- ใช้ Guards สำหรับ authentication/authorization
- Validate input ด้วย ValidationPipe + class-validator DTOs
- Return consistent response format

### Service Pattern
- Business logic อยู่ใน service เท่านั้น — ห้ามใส่ใน controller
- ใช้ Prisma Client สำหรับ database queries
- Handle errors ด้วย NestJS exceptions (NotFoundException, BadRequestException)
- Transaction ใช้ `prisma.$transaction()`

## Immutability (CRITICAL)

- ALWAYS create new objects, NEVER mutate
- ใช้ spread operator สำหรับ object updates
- ห้าม mutate function parameters

## Error Handling

- ใช้ NestJS built-in exceptions (HttpException subclasses)
- async/await with try-catch เสมอ
- Log detailed errors server-side, return safe messages to client
- Never expose stack traces or internal errors to API consumers

## File Organization

- 200-400 lines typical, 800 max
- One module per feature domain
- Shared utilities ใน `common/`
- DTO per operation (create, update, query)

## Console.log

- ห้ามใช้ console.log — ใช้ NestJS Logger service
- `private readonly logger = new Logger(MyService.name)`
