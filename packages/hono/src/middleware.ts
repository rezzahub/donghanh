export interface AuthResult {
  userId: string;
}

export interface AuthError {
  error: Response;
}

export type Authenticate = (
  request: Request,
) => Promise<AuthResult | AuthError>;

export function isAuthError(
  result: AuthResult | AuthError,
): result is AuthError {
  return "error" in result;
}
