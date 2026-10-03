// i18n-lint: allow-file cycle template data: catalog keys of the comment templates
import type { CommentTemplate } from '../../config/types';

// The comments the agent cycle leaves on the tracker, one template per work stage and per event. Every text is a catalog key
// (`cycle.agentFlow.comment.<id>.*`), so the comments follow the workspace's language until the person edits a text into a literal.
// Each template follows the comment standard: status first, sections a person who is not an engineer can read, technical detail last.

const key = (id: string, part: string): string => `cycle.agentFlow.comment.${id}.${part}`;

function template(id: string, sections: number, technicalDetail: boolean): CommentTemplate {
  return {
    title: key(id, 'title'),
    status: key(id, 'status'),
    sections: Array.from({ length: sections }, (_, i) => ({ heading: key(id, `s${i + 1}.heading`), guidance: key(id, `s${i + 1}.guidance`) })),
    technicalDetail,
  };
}

/** The stages and events that have a template, with how many sections each has. The catalogs define the texts. */
export const AGENT_FLOW_COMMENT_SHAPE: Record<string, { sections: number; technicalDetail: boolean }> = {
  triage: { sections: 4, technicalDetail: false },
  refine: { sections: 5, technicalDetail: true },
  plan: { sections: 4, technicalDetail: true },
  implement: { sections: 3, technicalDetail: true },
  review: { sections: 2, technicalDetail: true },
  qa: { sections: 2, technicalDetail: true },
  gate: { sections: 1, technicalDetail: false },
  question: { sections: 1, technicalDetail: false },
  pr: { sections: 3, technicalDetail: true },
  communicate: { sections: 3, technicalDetail: false },
};

/** The comments only the business cycle has: what the support agent says at the door and what customer success tells the reporter at the end. */
const BUSINESS_ONLY = ['triage', 'communicate'];

export function agentFlowComments(business = true): Record<string, CommentTemplate> {
  return Object.fromEntries(
    Object.entries(AGENT_FLOW_COMMENT_SHAPE)
      .filter(([id]) => business || !BUSINESS_ONLY.includes(id))
      .map(([id, s]) => [id, template(id, s.sections, s.technicalDetail)]),
  );
}
