import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function wikiPlugin() {
  return tree => {
    function visit(node) {
      if (!node.children || ['link', 'linkReference'].includes(node.type)) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== 'text') { visit(child); return [child]; }
        const parts = [];
        let start = 0;
        for (const match of child.value.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
          const [reference, alias] = match[1].split('|');
          const target = reference.split('#')[0].trim();
          if (!target) continue;
          parts.push({ type: 'text', value: child.value.slice(start, match.index) });
          parts.push({ type: 'link', url: '#wiki-' + encodeURIComponent(target), children: [{ type: 'text', value: alias || reference }] });
          start = match.index + match[0].length;
        }
        if (!parts.length) return [child];
        return [...parts, { type: 'text', value: child.value.slice(start) }];
      });
    }
    visit(tree);
  };
}

export default function ContextMarkdown({ content, onOpen }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm, wikiPlugin]} components={{
    a: ({ href, children }) => href?.startsWith('#wiki-')
      ? <button className="kb-wikilink" onClick={() => onOpen(decodeURIComponent(href.slice(6)))}>{children}</button>
      : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  }}>{content}</ReactMarkdown>;
}
