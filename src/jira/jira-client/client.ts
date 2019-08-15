import axios from 'axios';
import { URLSearchParams } from 'url';
import { Field, readField } from './model/fieldMetadata';
import { CreatedIssue, readCreatedIssue, IssuePickerResult, IssuePickerIssue } from './model/responses';
import { Project, Version, readVersion, Component, readComponent, IssueLinkType, User, MinimalIssue } from './model/entities';
import { DetailedSiteInfo } from '../../atlclients/authInfo';
import { IssueCreateMetadata, readIssueCreateMetadata } from './model/issueCreateMetadata';

const issueExpand = "names,transitions,renderedFields";
const API_VERSION = 2;

// JiraClient provides methods to invoke Jira REST API endpoints
//
// NOTE: Ensure there are not transitive dependencies to 'vscode' as that will
// prevent importing this file from webviews
export abstract class JiraClient {
    readonly baseUrl: string;
    readonly site: DetailedSiteInfo;
    readonly agent: any | undefined;

    constructor(site: DetailedSiteInfo, agent?: any) {
        this.site = site;
        this.baseUrl = site.baseApiUrl;
        this.agent = agent;
    }

    // Issue
    public async createIssue(params: any): Promise<CreatedIssue> {
        const result = await this.postToJira('issue', params);

        return readCreatedIssue(result);
    }

    public async getIssue(issueIdOrKey: string, fields: string[]): Promise<MinimalIssue> {
        const res = await this.getFromJira(`issue/${issueIdOrKey}`, { expand: issueExpand, fields: fields });
        return res;
    }

    public abstract async assignIssue(issueIdOrKey: string, accountId: string | undefined): Promise<any>;

    public async editIssue(issueIdOrKey: string, fields: any): Promise<any> {
        const res = await this.putToJira(`issue/${issueIdOrKey}`, { fields: fields });

        return res;
    }

    public async addComment(issueIdOrKey: string, comment: string): Promise<any> {
        const res = await this.postToJira(`issue/${issueIdOrKey}/comment`, { body: comment });

        return res;
    }

    public async transitionIssue(issueIdOrKey: string, transitionId: string): Promise<any> {
        const res = await this.postToJira(`issue/${issueIdOrKey}/transitions`, { transition: { id: transitionId } });

        return res;
    }

    public async getEditIssueMetadata(issueIdOrKey: string): Promise<IssueUpdateMetadata> {
        const res = await this.getFromJira(`issue/${issueIdOrKey}/editmeta`);

        return new IssueUpdateMetadata(res);
    }

    public async getCreateIssueMetadata(projectKey: string): Promise<IssueCreateMetadata> {
        const res = await this.getFromJira(`issue/createmeta`, {
            projectKeys: [projectKey],
            expand: 'projects.issuetypes.fields'
        });

        return readIssueCreateMetadata(res);
    }

    public async getIssuePickerSuggestions(query: string): Promise<IssuePickerIssue[]> {
        const res = await this.getFromJira('issue/picker', { query: query });

        const result: IssuePickerResult = res as IssuePickerResult;

        let suggestions: IssuePickerIssue[] = [];
        if (Array.isArray(result.sections)) {
            suggestions = result.sections.reduce((prev, curr) => prev.concat(curr.issues), [] as IssuePickerIssue[]);
        }

        return suggestions;
    }

    // Project
    public abstract async getProjects(query?: string, orderBy?: string): Promise<Project[]>;

    // User
    public async findUsersAssignableToIssue(issueKey: string, query: string): Promise<User[]> {
        const res = this.getFromJira('user/assignable/search', { issueKey: issueKey, query: query });
        return res;
    }

    public async findUsersAssignableToProject(project: string, query: string): Promise<User[]> {
        const res = this.getFromJira('user/assignable/search', { project: project, query: query });
        return res;
    }

    // JQL
    public async getFieldAutoCompleteSuggestions(fieldName: string, fieldValue: string): Promise<AutoCompleteSuggestion[]> {
        const res = await this.getFromJira('jql/autocompletedata/suggestions', { fieldName: fieldName, fieldValue: fieldValue });

        if (Array.isArray(res)) {
            return res.map((s: any) => readAutoCompleteSuggestion(s));
        }

        return [];
    }

    // Search
    public async searchForIssuesUsingJqlGet(jql: string, fields: string[]): Promise<any> {
        const res = await this.getFromJira('search', { jql: jql, fields: fields, expand: issueExpand });

        return res;
    }

    // These create things haven't been tested and maybe params should be typed.
    // Version
    public async createVersion(params: any): Promise<Version> {
        //{ body: { name: e.createData.name, project: this.state.key.split('-')[0] } }

        const result = await this.postToJira('version', params);

        return readVersion(result);
    }

    // Component
    public async createComponent(params: any): Promise<Component> {
        const result = await this.postToJira('component', params);

        return readComponent(result);
    }

    // IssueLink
    public async createIssueLink(params: any): Promise<any> {
        const result = await this.postToJira('issueLink', params);

        return result;
    }

    public async getIssueLinkTypes(): Promise<IssueLinkType[]> {
        const res = await this.getFromJira('issueLinkType');
        return res;
    }

    // Field
    public async getFields(params: any): Promise<Field[]> {
        const res = await this.getFromJira('field');
        if (Array.isArray(res)) {
            return res.map(f => readField(f));
        }

        return [];
    }

    // Myself
    public async getCurrentUser(): Promise<User> {
        const res = this.getFromJira('myself');

        return res;
    }

    // Attachment
    public async addAttachment(issuekey: string, params: any): Promise<any> {
        const res = this.postToJira(`issue/${issuekey}/attachments`, params);

        return res;
    }

    protected abstract authorization(): string;

    protected async getFromJira(url: string, queryParams?: any): Promise<any> {
        url = `${this.baseUrl}/api/${API_VERSION}/${url}`;
        if (queryParams) {
            const sp = new URLSearchParams();
            for (const [k, v] of Object.entries(queryParams)) {
                sp.append(k, `${v}`);
            }
            url = `${url}?${sp.toString()}`;
        }

        const res = await axios(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Authorization: this.authorization()
            },
            httpsAgent: this.agent
        });

        return res.data;
    }

    protected async postToJira(url: string, params: any): Promise<any> {
        url = `${this.baseUrl}/api/${API_VERSION}/${url}`;

        const res = await axios(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: this.authorization()
            },
            data: JSON.stringify(params),
            httpsAgent: this.agent
        });

        return res.data;
    }

    protected async putToJira(url: string, params: any): Promise<any> {
        url = `${this.baseUrl}/api/${API_VERSION}/${url}`;

        const res = await axios(url, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: this.authorization()
            },
            data: JSON.stringify(params),
            httpsAgent: this.agent
        });

        return res.data;
    }
}

// Classes
export interface AutoCompleteSuggestion {
    readonly value: string;
    readonly displayName: string;
}

export function readAutoCompleteSuggestion(params: any): AutoCompleteSuggestion {
    return {
        value: params.value,
        displayName: params.displayName
    };
}

// jiraIssueWebview, ca line 160
// res.fields['components'].allowedValues
export class IssueUpdateMetadata {
    public readonly fields: any;

    constructor(value: any) {
        this.fields = value.fields;
    }
}