
import { JiraIssueWebview } from './jiraIssueWebview';
import { AbstractMultiViewManager } from './multiViewManager';
import { DetailedIssue } from '../jira/jira-client/model/detailedJiraIssue';

// JiraIssueViewManager manages views for issue details.
export class JiraIssueViewManager extends AbstractMultiViewManager<DetailedIssue> {

    dataKey(data: DetailedIssue): string {
        return data.key;

    }

    createView(extensionPath: string) {
        return new JiraIssueWebview(extensionPath);
    }

}