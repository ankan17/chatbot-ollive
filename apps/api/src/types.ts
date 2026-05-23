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
  namespace Express {
    interface Request {
      user?: AuthUser;
      guest?: GuestIdentity;
      // requestId?: string already declared by Plan 3's correlation middleware
    }
  }
}
