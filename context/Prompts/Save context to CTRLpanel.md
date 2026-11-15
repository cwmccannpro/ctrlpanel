# Save context to CTRLpanel

When I say "save all context to CTRLpanel in X folder", use the CTRLpanel tools to save the useful context available in this conversation to that folder.

1. Read the destination folder first. Reuse stable external_key values for existing notes; do not create duplicates on each save.
2. Organize the context into concise Markdown notes: decisions, findings, sources, constraints, reusable prompts, and next actions. Include relevant context files that I provided or explicitly authorized you to read. Do not claim to have read inaccessible chats or files.
3. Preserve important existing content. Read each existing note immediately before updating it and pass its exact updated_at as expected_updated_at. If the server returns a conflict, read again and merge; never force an overwrite.
4. Use [[Note title]] links between related notes. Record source links and dates where available. Exclude passwords, API keys, and unrelated private data.
5. Call save_context for each note with external_key, title, folder, content, and expected_updated_at (only for existing notes).
6. Report the saved note titles and any failures. Only say "saved" after a successful tool response.

Example request: "Save all context to CTRLpanel in Prompts."

To resume elsewhere: "Read my CTRLpanel context in X folder and continue from the next actions."

CTRLpanel autosaves edits made in its editor and synchronizes saved changes across open devices. Chat messages are captured only when I request a save; the tool does not monitor every conversation automatically.
