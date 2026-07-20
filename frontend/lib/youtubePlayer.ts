/**
 * Builds a self-contained HTML page that uses the YouTube IFrame API to play
 * a clip segment with precise start/end times. Direct embed URLs often fail in
 * React Native WebViews (config error 153) and ignore end= parameters.
 */
export function buildYouTubeClipHtml(
  videoId: string,
  startSeconds: number,
  endSeconds?: number | null,
  options?: { autoplay?: boolean }
): string {
  const start = Math.max(0, Math.floor(startSeconds));
  const end = endSeconds != null && endSeconds > start ? Math.floor(endSeconds) : null;
  const autoplay = options?.autoplay ?? false;

  const endPlayerVar = end != null ? `end: ${end},` : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <meta name="referrer" content="strict-origin-when-cross-origin" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #000; }
    #player { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="player"></div>
  <script>
    var player;
    var endSeconds = ${end != null ? end : "null"};
    var startSeconds = ${start};
    var pollId = null;

    function onYouTubeIframeAPIReady() {
      player = new YT.Player("player", {
        height: "100%",
        width: "100%",
        videoId: "${videoId}",
        playerVars: {
          autoplay: ${autoplay ? 1 : 0},
          playsinline: 1,
          modestbranding: 1,
          rel: 0,
          controls: 1,
          fs: 1,
          start: startSeconds,
          ${endPlayerVar}
          origin: "https://www.courtcoachai.org"
        },
        host: "https://www.youtube-nocookie.com",
        events: {
          onReady: function(e) {
            e.target.seekTo(startSeconds, true);
            if (${autoplay ? "true" : "false"}) e.target.playVideo();
          },
          onStateChange: function(e) {
            if (e.data === YT.PlayerState.PLAYING && endSeconds) {
              if (pollId) clearInterval(pollId);
              pollId = setInterval(function() {
                if (!player || typeof player.getCurrentTime !== "function") return;
                var t = player.getCurrentTime();
                if (t >= endSeconds - 0.25) {
                  player.pauseVideo();
                  player.seekTo(startSeconds, true);
                }
              }, 400);
            }
            if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) {
              if (pollId) { clearInterval(pollId); pollId = null; }
            }
          },
          onError: function(e) {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: "youtube_error",
                code: e.data
              }));
            }
          }
        }
      });
    }
  </script>
  <script src="https://www.youtube.com/iframe_api"></script>
</body>
</html>`;
}
