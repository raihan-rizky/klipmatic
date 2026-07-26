class JobError(Exception):
    """Kegagalan job dengan kode stabil.

    Worker tidak pernah menghasilkan teks untuk user; pemetaan kode ke
    kalimat Indonesia ada di apps/web/lib/errorMessages.ts.
    """

    def __init__(self, code: str, message: str = "", terminal: bool = False):
        super().__init__(message or code)
        self.code = code
        self.terminal = terminal
