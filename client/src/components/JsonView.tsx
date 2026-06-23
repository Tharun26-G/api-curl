interface Props {
  text: string;
  className?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch] as string);
}

function highlight(text: string): string {
  let pretty = text;
  try {
    const parsed = JSON.parse(text);
    pretty = JSON.stringify(parsed, null, 2);
  } catch {
    return escapeHtml(text);
  }
  const escaped = escapeHtml(pretty);
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+\-]?\d+)?)/g,
    match => {
      let cls = 'tk-num';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'tk-key' : 'tk-str';
      } else if (/true|false/.test(match)) {
        cls = 'tk-bool';
      } else if (/null/.test(match)) {
        cls = 'tk-null';
      }
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

export default function JsonView({ text, className }: Props) {
  return (
    <pre
      className={`code-block ${className || ''}`}
      dangerouslySetInnerHTML={{ __html: text ? highlight(text) : '<span class="tk-null">(empty)</span>' }}
    />
  );
}
