import NProgress from "nprogress";
let pending = 0;
/** Track concurrent requests without finishing while another request is active. */
export function beginRequest() {
  if (typeof window === "undefined") return () => {};
  if (pending++ === 0) NProgress.start();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    pending = Math.max(0, pending - 1);
    if (pending === 0) NProgress.done();
  };
}
