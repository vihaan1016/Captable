import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Sonner injects its own stylesheet at runtime and drives it from CSS custom
 * properties, so Tailwind classes alone lose to it: the toast has to be themed
 * through the library's own variables. `--border-radius: 0` keeps it square,
 * and the colors are bound to the design tokens rather than restated.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--background)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--background)",
          "--success-text": "var(--success)",
          "--success-border": "var(--border)",
          "--error-bg": "var(--background)",
          "--error-text": "var(--refusal)",
          "--error-border": "var(--border)",
          "--border-radius": "0px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "group toast font-mono !text-[11px] !leading-relaxed",
          title: "!font-mono !text-[11px] !uppercase !tracking-[0.12em]",
          description: "!font-mono !text-[11px] !text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
