import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import SignaturePadLib from "signature_pad";

// Thin wrapper around the signature_pad library, sized to fill its container
// and exposing clear()/isEmpty()/toDataURL() via a ref for the parent form.
const SignaturePad = forwardRef(function SignaturePad(_props, ref) {
  const canvasRef = useRef(null);
  const padRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const { width } = canvas.getBoundingClientRect();
      canvas.width = width * ratio;
      canvas.height = 160 * ratio;
      const ctx = canvas.getContext("2d");
      ctx.scale(ratio, ratio);
      if (padRef.current) padRef.current.clear();
    };
    padRef.current = new SignaturePadLib(canvas, { backgroundColor: "rgb(255,255,255)", penColor: "rgb(17,18,20)" });
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useImperativeHandle(ref, () => ({
    clear: () => padRef.current?.clear(),
    isEmpty: () => padRef.current?.isEmpty() ?? true,
    toDataURL: () => padRef.current?.toDataURL("image/png"),
  }));

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: 160,
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          touchAction: "none",
          background: "#fff",
        }}
      />
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        style={{ marginTop: 8 }}
        onClick={() => padRef.current?.clear()}
      >
        Clear signature
      </button>
    </div>
  );
});

export default SignaturePad;
