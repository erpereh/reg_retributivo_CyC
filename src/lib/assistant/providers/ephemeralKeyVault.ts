export interface EphemeralKeyScope { readonly profileId: string; readonly endpoint: string }

export interface EphemeralKeyVault {
  setKey(scope: EphemeralKeyScope, value: string): void;
  clearKey(): void;
  withKey<T>(scope: EphemeralKeyScope, callback: (key: string | undefined) => T | Promise<T>): Promise<T>;
}

function scopeId(scope: EphemeralKeyScope): string {
  return `${scope.profileId}\u0000${scope.endpoint.replace(/\/+$/, "")}`;
}

export function createEphemeralKeyVault(): EphemeralKeyVault {
  let key: string | undefined;
  let binding: string | undefined;
  return Object.freeze({
    setKey(scope: EphemeralKeyScope, value: string) { key = value || undefined; binding = key ? scopeId(scope) : undefined; },
    clearKey() { key = undefined; binding = undefined; },
    async withKey<T>(scope: EphemeralKeyScope, callback: (current: string | undefined) => T | Promise<T>): Promise<T> {
      return callback(binding === scopeId(scope) ? key : undefined);
    },
  });
}
