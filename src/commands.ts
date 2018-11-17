import * as vscode from 'vscode';
import { currentUserJira } from './commands//jira/currentUser';
import { authenticateJira, clearJiraAuth } from './commands/authenticate';
import { showProjectSelectionDialog } from './commands/jira/selectProject';
import { showSiteSelectionDialog } from './commands/jira/selectSite';
import { IssueHoverProvider } from './views/jira/issueHoverProvider';
import { Container } from './container';
import { transitionIssue } from './commands/jira/transitionIssue';

export enum Commands {
    BitbucketSelectContainer = 'atlascode.bb.selectContainer',
    BitbucketFetchPullRequests = 'atlascode.bb.fetchPullRequests',
    BitbucketRefreshPullRequests = 'atlascode.bb.refreshPullRequests',
    BitbucketShowPullRequestDetails = 'atlascode.bb.showPullRequestDetails',
    BitbucketPullRequestsNextPage = 'atlascode.bb.pullReqeustsNextPage',
    AuthenticateBitbucket = 'atlascode.bb.authenticate',
    ClearBitbucketAuth = 'atlascode.bb.clearAuth',
    CurrentUserBitbucket = 'atlascode.bb.me',
    currentUserJira = 'atlascode.jira.me',
    AuthenticateJira = 'atlascode.jira.authenticate',
    ClearJiraAuth = 'atlascode.jira.clearAuth',
    SelectProject = 'atlascode.jira.selectProject',
    SelectSite = 'atlascode.jira.selectSite',
    RefreshJiraExplorer = 'atlascode.jira.refreshExplorer',
    ShowIssue = 'atlascode.jira.showIssue',
    ShowConfigPage = 'atlascode.showConfigPage',
    TransitionIssue = 'atlascode.jira.transitionIssue'
}

export function registerCommands(vscodeContext: vscode.ExtensionContext) {
    vscodeContext.subscriptions.push(
        vscode.commands.registerCommand(Commands.ShowConfigPage, Container.configWebview.createOrShow, Container.configWebview),
        vscode.commands.registerCommand(Commands.currentUserJira, currentUserJira),
        vscode.commands.registerCommand(Commands.AuthenticateJira, authenticateJira),
        vscode.commands.registerCommand(Commands.ClearJiraAuth, clearJiraAuth),
        vscode.commands.registerCommand(Commands.SelectProject, showProjectSelectionDialog),
        vscode.commands.registerCommand(Commands.SelectSite, showSiteSelectionDialog),
        vscode.commands.registerCommand(Commands.ShowIssue, async (issue) => {
            await Container.jiraIssueViewManager.createOrShow(issue);
        }),
        vscode.languages.registerHoverProvider({ scheme: 'file' }, new IssueHoverProvider()),
        vscode.commands.registerCommand(Commands.TransitionIssue, (issue) => transitionIssue(issue))
    );
}
