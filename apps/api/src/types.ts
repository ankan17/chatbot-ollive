/** Express Request augmentation — adds req.user and req.guest (module augmentation, no runtime exports). */

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

export interface GuestIdentity {
  id: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- global module augmentation requires `namespace`
  namespace Express {
    interface Request {
      user?: AuthUser;
      guest?: GuestIdentity;
      // requestId?: string already declared by Plan 3's correlation middleware
    }
  }
}
