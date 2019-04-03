import * as vscode from 'vscode';
import { currentUserJira } from './commands//jira/currentUser';
import { authenticateJira, clearJiraAuth, authenticateBitbucket, clearBitbucketAuth, authenticateBitbucketStaging, authenticateJiraStaging, clearJiraAuthStaging } from './commands/authenticate';
import { showProjectSelectionDialog } from './commands/jira/selectProject';
import { showSiteSelectionDialog } from './commands/jira/selectSite';
import { Container } from './container';
import { transitionIssue } from './commands/jira/transitionIssue';
import { assignIssue } from './commands/jira/assignIssue';
import { startPipeline } from './commands/bitbucket/startPipeline';
import { IssueNode } from './views/nodes/issueNode';
import { BaseNode } from './views/nodes/baseNode';
import { BranchNode } from './views/pipelines/PipelinesTree';
import { viewScreenEvent, Registry } from './analytics';
import { Issue, isIssue } from './jira/jiraIssue';
import { showIssue } from './commands/jira/showIssue';
import { createIssue } from './commands/jira/createIssue';

export enum Commands {
    BitbucketSelectContainer = 'atlascode.bb.selectContainer',
    BitbucketFetchPullRequests = 'atlascode.bb.fetchPullRequests',
    BitbucketRefreshPullRequests = 'atlascode.bb.refreshPullRequests',
    BitbucketShowPullRequestDetails = 'atlascode.bb.showPullRequestDetails',
    BitbucketPullRequestsNextPage = 'atlascode.bb.pullReqeustsNextPage',
    BitbucketViewInWebBrowser = 'atlascode.bb.viewInWebBrowser',
    AuthenticateBitbucket = 'atlascode.bb.authenticate',
    AuthenticateBitbucketStaging = 'atlascode.bb.authenticateStaging',
    ClearBitbucketAuth = 'atlascode.bb.clearAuth',
    CurrentUserBitbucket = 'atlascode.bb.me',
    currentUserJira = 'atlascode.jira.me',
    AuthenticateJira = 'atlascode.jira.authenticate',
    AuthenticateJiraStaging = 'atlascode.jira.authenticateStaging',
    ClearJiraAuth = 'atlascode.jira.clearAuth',
    ClearJiraAuthStaging = 'atlascode.jira.clearAuthStaging',
    SelectProject = 'atlascode.jira.selectProject',
    SelectSite = 'atlascode.jira.selectSite',
    CreateIssue = 'atlascode.jira.createIssue',
    RefreshJiraExplorer = 'atlascode.jira.refreshExplorer',
    ShowIssue = 'atlascode.jira.showIssue',
    ShowConfigPage = 'atlascode.showConfigPage',
    ShowWelcomePage = 'atlascode.showWelcomePage',
    TransitionIssue = 'atlascode.jira.transitionIssue',
    AssignIssueToMe = 'atlascode.jira.assignIssueToMe',
    StartWorkOnIssue = 'atlascode.jira.startWorkOnIssue',
    CreatePullRequest = 'atlascode.bb.createPullRequest',
    StartPipeline = 'atlascode.bb.startPipeline',
    RefreshPipelines = 'atlascode.bb.refreshPipelines',
    ShowPipeline = 'atlascode.bb.showPipeline',
    PipelinesNextPage = 'atlascode.bb.pipelinesNextPage',
    BitbucketIssuesNextPage = 'atlascode.bb.issuesNextPage',
    BitbucketIssuesRefresh = 'atlascode.bb.refreshIssues',
    CreateBitbucketIssue = 'atlascode.bb.createIssue',
    ShowBitbucketIssue = 'atlascode.bb.showIssue',
    ViewDiff = 'atlascode.viewDiff'
}

export function registerCommands(vscodeContext: vscode.ExtensionContext) {
    vscodeContext.subscriptions.push(
        vscode.commands.registerCommand(Commands.ShowConfigPage, Container.configWebview.createOrShow, Container.configWebview),
        vscode.commands.registerCommand(Commands.ShowWelcomePage, Container.welcomeWebview.createOrShow, Container.welcomeWebview),
        vscode.commands.registerCommand(Commands.currentUserJira, currentUserJira),
        vscode.commands.registerCommand(Commands.AuthenticateJira, authenticateJira),
        vscode.commands.registerCommand(Commands.AuthenticateJiraStaging, authenticateJiraStaging),
        vscode.commands.registerCommand(Commands.ClearJiraAuth, clearJiraAuth),
        vscode.commands.registerCommand(Commands.ClearJiraAuthStaging, clearJiraAuthStaging),
        vscode.commands.registerCommand(Commands.AuthenticateBitbucket, authenticateBitbucket),
        vscode.commands.registerCommand(Commands.AuthenticateBitbucketStaging, authenticateBitbucketStaging),
        vscode.commands.registerCommand(Commands.ClearBitbucketAuth, clearBitbucketAuth),
        vscode.commands.registerCommand(Commands.BitbucketViewInWebBrowser, async (prNode: BaseNode) => vscode.commands.executeCommand('vscode.open', (await prNode.getTreeItem()).resourceUri)),
        vscode.commands.registerCommand(Commands.SelectProject, showProjectSelectionDialog),
        vscode.commands.registerCommand(Commands.SelectSite, showSiteSelectionDialog),
        vscode.commands.registerCommand(Commands.CreateIssue, (data: any) => createIssue(data)),
        vscode.commands.registerCommand(Commands.ShowIssue, async (issue: any) => await showIssue(issue)),
        vscode.commands.registerCommand(Commands.TransitionIssue, (issue) => transitionIssue(issue)),
        vscode.commands.registerCommand(Commands.AssignIssueToMe, (issuNode: IssueNode) => assignIssue(issuNode)),
        vscode.commands.registerCommand(Commands.StartWorkOnIssue, (issueNodeOrIssue: IssueNode | Issue) => Container.startWorkOnIssueWebview.createOrShowIssue(isIssue(issueNodeOrIssue) ? issueNodeOrIssue : issueNodeOrIssue.issue)),
        vscode.commands.registerCommand(Commands.StartPipeline, (node: BranchNode) => startPipeline(node)),
        vscode.commands.registerCommand(Commands.ViewDiff, async (...diffArgs: any[]) => {
            viewScreenEvent(Registry.screen.pullRequestDiffScreen).then(e => { Container.analyticsClient.sendScreenEvent(e); });
            vscode.commands.executeCommand('vscode.diff', ...diffArgs);
        }),
        vscode.commands.registerCommand(Commands.ShowPipeline, (pipelineInfo: any) => {
            Container.pipelineViewManager.createOrShow(pipelineInfo);
        }),
        vscode.commands.registerCommand(Commands.ShowBitbucketIssue, (issue: Bitbucket.Schema.Issue) => Container.bitbucketIssueViewManager.createOrShow(issue))
    );
}
