import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Compartment, EditorState, StateField } from '@codemirror/state';
import { Decoration, EditorView, keymap, placeholder, WidgetType } from '@codemirror/view';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { autocompletion, completionKeymap, startCompletion } from '@codemirror/autocomplete';
import ContextMarkdown from './ContextMarkdown.jsx';

class RenderedBlock extends WidgetType {
  constructor(text, open) { super(); this.text = text; this.open = open; }
  eq(other) { return this.text === other.text; }
  toDOM() {
    const host = document.createElement('div');
    host.className = 'ctx-formatted-block';
    this.root = createRoot(host);
    this.root.render(<ContextMarkdown content={this.text} onOpen={this.open} />);
    return host;
  }
  destroy() { const root = this.root; if (root) queueMicrotask(() => root.unmount()); }
  ignoreEvent(event) { return !!event.target.closest('a,button'); }
}

function liveFormat(open) {
  function format(state) {
    const ranges = [], selection = state.selection.main;
    syntaxTree(state).iterate({ enter(node) {
      const { name, from, to } = node;
      if (from === to) return;
      if (node.node.parent?.name === 'Document' && (selection.to < from || selection.from > to)) {
        ranges.push(Decoration.replace({ block: true, widget: new RenderedBlock(state.sliceDoc(from, to), open) }).range(from, to));
        return false;
      }
      const heading = /^ATXHeading([1-6])$/.exec(name);
      const cls = heading ? 'ctx-h' + heading[1] : ({ StrongEmphasis: 'ctx-bold', Emphasis: 'ctx-italic', InlineCode: 'ctx-code', Strikethrough: 'ctx-strike', Link: 'ctx-inline-link' })[name];
      if (cls) ranges.push(Decoration.mark({ class: cls }).range(from, to));
      if (['HeaderMark', 'EmphasisMark','CodeMark'].includes(name)) {
        ranges.push(Decoration.mark({ class: 'ctx-mark' }).range(from, to));
      }
    } });
    return Decoration.set(ranges, true);
  }
  return StateField.define({
    create: format,
    update(value, tr) {
      return tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? format(tr.state) : value;
    },
    provide: field => EditorView.decorations.from(field)
  });
}

export default function ContextWriter({ content, notes, raw, onChange, onOpen, editorRef }) {
  const host = useRef(null), latest = useRef(null), mode = useRef(new Compartment());
  const [ready, setReady] = useState(false);
  latest.current = { content, notes, raw, onChange, onOpen };
  const formatting = useRef(null);
  useEffect(() => {
    const open = target => latest.current.onOpen(target);
    formatting.current = liveFormat(open);
    const complete = context => {
      const typed = context.matchBefore(/\[\[[^\]\n|]*/);
      if (!typed) return null;
      return { from: typed.from + 2, options: latest.current.notes.map(note => ({
        label: note.title, detail: note.folder, type: 'text',
        apply(view, option, from, to) {
          const end = view.state.sliceDoc(to, to + 2) === ']]' ? to + 2 : to;
          const link = note.id + '|' + note.title.replace(/[\]|\n]/g, ' ') + ']]';
          view.dispatch({ changes: { from, to: end, insert: link }, selection: { anchor: from + link.length } });
        }
      })) };
    };
    const view = new EditorView({ parent: host.current, state: EditorState.create({
      doc: latest.current.content,
      extensions: [markdown({ base: markdownLanguage }), history(), EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Markdown editor', spellcheck: 'true' }),
        placeholder('Write a note. Type [[ to link another star.'),
        autocompletion({ override: [complete] }), keymap.of([...completionKeymap, ...markdownKeymap, ...historyKeymap, ...defaultKeymap]),
        mode.current.of(latest.current.raw ? [] : formatting.current),
        EditorView.updateListener.of(update => { if (update.docChanged) latest.current.onChange(update.state.doc.toString()); })]
    }) });
    editorRef.current = {
      wrap(before, after = '') {
        const { from, to } = view.state.selection.main;
        const text = view.state.sliceDoc(from,to);
        view.dispatch({ changes: { from, to, insert: before + text + after },
          selection: { anchor: from + before.length, head: from + before.length + text.length } });
        view.focus(); if (before === '[[') startCompletion(view);
      }, view
    };
    setReady(true);
    return () => { editorRef.current = null; view.destroy(); };
  }, [editorRef]);
  useEffect(() => {
    editorRef.current?.view.dispatch({ effects: mode.current.reconfigure(raw ? [] : formatting.current) });
  }, [raw, editorRef]);
  useEffect(() => {
    const view = editorRef.current?.view;
    if (view && content !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, [content, editorRef]);
  return <div className={'ctx-writing-area' + (raw ? ' raw' : '')}><div ref={host} />{!ready && <ContextMarkdown content={content} onOpen={onOpen} />}</div>;
}
