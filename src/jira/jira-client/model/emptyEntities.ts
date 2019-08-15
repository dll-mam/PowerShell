import { Avatars, IssueType, StatusCategory, Priority, User, Status, Transition, MinimalIssue, Project, Comment } from "./entities";
import { emptySiteInfo } from "../../../atlclients/authInfo";

export const emptyAvatars: Avatars = { '48x48': '', '24x24': '', '16x16': '', '32x32': '' };

export const emptyUser: User = {
    accountId: '',
    active: true,
    avatarUrls: emptyAvatars,
    displayName: '',
    emailAddress: '',
    key: '',
    name: '',
    self: '',
    timeZone: ''
};

export const emptyIssueType: IssueType = {
    avatarId: -1,
    description: '',
    iconUrl: '',
    id: '',
    name: '',
    self: '',
    subtask: false
};

export const emptyStatusCategory: StatusCategory = {
    colorName: '',
    id: -1,
    key: '',
    name: '',
    self: ''
};

export const emptyStatus: Status = {
    description: '',
    iconUrl: '',
    id: '',
    name: '',
    self: '',
    statusCategory: emptyStatusCategory
};

export const emptyPriority: Priority = {
    id: '',
    name: '',
    iconUrl: ''
};

export const emptyTransition: Transition = {
    hasScreen: false,
    id: '',
    isConditional: false,
    isGlobal: false,
    isInitial: false,
    name: '',
    to: emptyStatus,
};

export const emptyMinimalIssue: MinimalIssue = {
    key: '',
    id: '',
    self: '',
    created: new Date(0),
    updated: new Date(0),
    description: '',
    descriptionHtml: '',
    summary: '',
    status: emptyStatus,
    priority: emptyPriority,
    issueType: emptyIssueType,
    subtasks: [],
    issuelinks: [],
    transitions: [],
    siteDetails: emptySiteInfo,
    isEpic: false,
    epicChildren: [],
    epicName: '',
    epicLink: ''
};

export const emptyProject: Project = {
    id: "",
    name: "",
    key: "",
    avatarUrls: {},
    projectTypeKey: "",
    self: "",
    simplified: false,
    style: "",
    isPrivate: false
};

export const emptyComment: Comment = {
    author: emptyUser,
    body: '',
    created: '',
    id: '',
    self: ''
};