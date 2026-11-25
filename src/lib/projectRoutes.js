export const projectPath = (projectId, tab = '') => `/projects/${projectId}${tab ? `/${tab}` : ''}`;

export function projectCrmPath(projects, boardId) {
  const linked = boardId && projects.find((project) => project.crm_board_id === boardId);
  if (linked) return projectPath(linked.id, 'crm');
  const params = new URLSearchParams({ view: 'crm' });
  if (boardId) params.set('board', boardId);
  return `/projects?${params}`;
}
