declare module 'ffprobe-static' {
  const ffprobe: { path: string; version: string };
  export default ffprobe;
}

declare module 'ffmpeg-static' {
  const path: string | null;
  export default path;
}
