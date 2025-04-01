# Use Node.js base image from Amazon ECR Public Gallery
FROM public.ecr.aws/docker/library/node:22 AS build

WORKDIR /app

# Cache packages installation
COPY package.json package.json
COPY pnpm-lock.yaml pnpm-lock.yaml

ENV CI=true
RUN npm install -g pnpm
RUN pnpm i

# Copy source files and TypeScript configuration
COPY ./src ./src
COPY ./tsconfig.json ./tsconfig.json
COPY ./tsup.config.ts ./tsup.config.ts

ENV NODE_ENV=production

# Build the TypeScript project
RUN pnpm run build

# Use a smaller base image for the final stage from Amazon ECR Public Gallery
FROM public.ecr.aws/docker/library/node:22-slim

WORKDIR /app

# Copy built assets from the build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml

RUN npm install -g pnpm

# Install only production dependencies
RUN pnpm i --prod

ENV NODE_ENV=production

RUN groupadd -r appgroup && useradd -r -g appgroup appuser
RUN chown -R appuser:appgroup /app

USER appuser

ENTRYPOINT [ "node" ]

EXPOSE 8080
EXPOSE 34431
