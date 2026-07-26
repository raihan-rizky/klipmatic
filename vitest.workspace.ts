// Glob, bukan path eksplisit: apps/web baru ada di Task 11. Vitest menolak
// path eksplisit yang belum ada, sementara glob yang tidak cocok diabaikan.
export default ['packages/*', 'apps/*']
