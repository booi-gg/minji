import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

// Raw HTML is never rendered (no rehype-raw); links open in a new tab; images only over https.
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    typeof src === "string" && src.startsWith("https://") ? (
      <img src={src} alt={alt ?? ""} loading="lazy" />
    ) : null,
};

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

export const Markdown = ({ text }: { text: string }) => (
  <div className="markdown">
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
      {text}
    </ReactMarkdown>
  </div>
);
