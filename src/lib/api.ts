export async function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  if (typeof window !== 'undefined') {
    const token = window.sessionStorage.getItem('cosmiclabs_op_token')?.trim();
    if (token && !headers.has('X-Operator-Token') && !headers.has('Authorization')) {
      headers.set('X-Operator-Token', token);
    }
  }
  return window.fetch(input, { ...init, headers });
}
