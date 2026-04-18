/**
 * Type stub for @internal/http-client
 *
 * The real package lives at a path symlinked from node_modules/@internal/http-client.
 * This stub satisfies TypeScript in environments where the symlink is not resolvable
 * (CI, sandboxes) while the runtime package is present on the host machine.
 *
 * Remove this file if the @internal/http-client package is ever published to a
 * proper registry or if the project migrates to a standard HTTP client (axios, etc.).
 */

declare module '@internal/http-client' {
  interface HttpClientConfig {
    headers?: Record<string, string>;
    params?: Record<string, string | number | boolean>;
    /** Reject requests to non-HTTPS URLs */
    enforceHttps?: boolean;
    timeout?: number;
  }

  interface HttpResponse<T = unknown> {
    data: T;
    status: number;
    headers: Record<string, string>;
  }

  interface HttpClient {
    get<T = unknown>(url: string, config?: HttpClientConfig): Promise<HttpResponse<T>>;
    post<T = unknown>(url: string, data?: unknown, config?: HttpClientConfig): Promise<HttpResponse<T>>;
    put<T = unknown>(url: string, data?: unknown, config?: HttpClientConfig): Promise<HttpResponse<T>>;
    patch<T = unknown>(url: string, data?: unknown, config?: HttpClientConfig): Promise<HttpResponse<T>>;
    delete<T = unknown>(url: string, config?: HttpClientConfig): Promise<HttpResponse<T>>;
  }

  export const httpClient: HttpClient;
}
