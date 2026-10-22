export function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  return origin === new URL(request.url).origin || (!!env.FRONTEND_URL && origin === new URL(env.FRONTEND_URL).origin);
}

export function loginReturn(request, env) {
  const url = new URL(request.url);
  const target = url.searchParams.get('return_to') || url.origin + '/';
  const allowed = [url.origin + '/', env.FRONTEND_URL].filter(Boolean);
  return allowed.includes(target) ? target : null;
}
