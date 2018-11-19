import { window } from 'vscode';
import { AbstractReactWebview, InitializingWebview } from './abstractWebview';
import { PullRequest } from '../bitbucket/model';
import { PullRequestApi } from '../bitbucket/pullRequests';
import { getCurrentUser } from '../bitbucket/user';
import { PRData, CheckoutResult } from '../ipc/prMessaging';
import { Action } from '../ipc/messaging';
import { Logger } from '../logger';
import { Repository, Remote } from "../typings/git";
import { isPostComment, isCheckout } from '../ipc/prActions';

interface PRState {
    prData: PRData;
    remote?: Remote;
    repository?: Repository;
}

const emptyState: PRState = { prData: { type: '', currentBranch: '' } };

export class PullRequestWebview extends AbstractReactWebview<PRData | CheckoutResult, Action> implements InitializingWebview<PullRequest> {
    private _state: PRState = emptyState;

    constructor(extensionPath: string) {
        super(extensionPath);
    }

    public get title(): string {
        return "Pull Request";
    }
    public get id(): string {
        return "pullRequestView";
    }

    initialize(data: PullRequest) {
        this.updatePullRequest(data);
    }

    public invalidate() {
        this.forceUpdatePullRequest();
    }

    private validatePRState(s: PRState): boolean {
        return !!s.repository
            && !!s.remote
            && !!s.prData.pr
            && !!s.prData.currentUser
            && !!s.prData.commits
            && !!s.prData.comments;
    }

    protected onMessageReceived(e: Action): boolean {
        let handled = super.onMessageReceived(e);

        if (!handled) {
            switch (e.action) {
                case 'approve': {
                    handled = true;
                    this.approve().catch((e: any) => {
                        Logger.error(new Error(`error approving pull request: ${e}`));
                        window.showErrorMessage('Pull reqeust could not be approved');
                    });
                    break;
                }
                case 'comment': {
                    if (isPostComment(e)) {
                        handled = true;
                        this.postComment(e.content, e.parentCommentId).catch((e: any) => {
                            Logger.error(new Error(`error posting comment on the pull request: ${e}`));
                            window.showErrorMessage('Pull reqeust comment could not be posted');
                        });
                    }
                    break;
                }
                case 'checkout': {
                    if (isCheckout(e)) {
                        handled = true;
                        this.checkout(e.branch);
                    }
                    break;
                }
                case 'refreshPR': {
                    handled = true;
                    this.forceUpdatePullRequest();
                    break;
                }
            }
        }

        return handled;
    }

    private async updatePullRequest(pr: PullRequest) {
        if (this._panel) { this._panel.title = `Pull Request #${pr.data.id}`; }

        if (this.validatePRState(this._state)) {
            this._state.prData.type = 'update';
            this._state.prData.currentBranch = pr.repository.state.HEAD!.name!;
            this.postMessage(this._state.prData);
            return;
        }
        let promises = Promise.all([
            getCurrentUser(),
            PullRequestApi.getCommits(pr),
            PullRequestApi.getComments(pr)
        ]);

        promises.then(
            result => {
                let [currentUser, commits, comments] = result;
                this._state = {
                    repository: pr.repository,
                    remote: pr.remote,
                    prData: {
                        type: 'update'
                        , currentUser: currentUser
                        , pr: pr.data
                        , commits: commits
                        , comments: comments
                        , currentBranch: pr.repository.state.HEAD!.name!
                    }
                };
                this.postMessage(this._state.prData);
            },
            reason => {
                Logger.debug("promise rejected!", reason);
            });
    }

    private async approve() {
        await PullRequestApi.approve({ repository: this._state.repository!, remote: this._state.remote!, data: this._state.prData.pr! });
        await this.forceUpdatePullRequest();
    }

    private checkout(branch: string) {
        this._state.repository!.checkout(branch || this._state.prData.pr!.source!.branch!.name!)
            .then(() => this.postMessage({
                type: 'checkout',
                currentBranch: this._state.repository!.state.HEAD!.name!
            }))
            .catch((e: any) => {
                Logger.error(new Error(`error checking out the pull request branch: ${e}`));
                window.showErrorMessage('Pull request branch could not be checked out');
                this.postMessage({
                    type: 'checkout',
                    error: e.stderr || e,
                    currentBranch: this._state.repository!.state.HEAD!.name!
                });
            });
    }

    private async postComment(text: string, parentId?: number) {
        await PullRequestApi.postComment({ repository: this._state.repository!, remote: this._state.remote!, data: this._state.prData.pr! }, text, parentId);
        await this.forceUpdateComments();
    }

    private async forceUpdatePullRequest() {
        const result = await PullRequestApi.get({ repository: this._state.repository!, remote: this._state.remote!, data: this._state.prData.pr! });
        this._state.prData.pr = result.data;
        this._state.prData.currentBranch = result.repository.state.HEAD!.name!;
        await this.updatePullRequest(result).catch(reason => {
            Logger.debug("update rejected", reason);
        });
    }

    private async forceUpdateComments() {
        const pr = { repository: this._state.repository!, remote: this._state.remote!, data: this._state.prData.pr! };
        this._state.prData.comments = await PullRequestApi.getComments(pr);
        await this.updatePullRequest(pr);
    }
}