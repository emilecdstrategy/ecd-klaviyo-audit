let closeGuard: (() => boolean) | null = null;

export function setAuditWizardCloseGuard(fn: (() => boolean) | null) {
  closeGuard = fn;
}

export function shouldConfirmAuditWizardClose(): boolean {
  return closeGuard?.() ?? false;
}
