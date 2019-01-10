import { AbstractReactWebview } from './abstractWebview';
import { Action } from '../ipc/messaging';
import { commands, window, Uri } from 'vscode';
import { Logger } from '../logger';
import { Container } from '../container';
import { RefType } from '../typings/git';
import { CreatePRData, RepoData, CreatePullRequestResult, CommitsResult } from '../ipc/prMessaging';
import { isCreatePullRequest, CreatePullRequest, isFetchDetails, FetchDetails } from '../ipc/prActions';
import { PullRequestApi } from '../bitbucket/pullRequests';
import { RepositoriesApi } from '../bitbucket/repositories';

export class PullRequestCreatorWebview extends AbstractReactWebview<CreatePRData | CreatePullRequestResult | CommitsResult,Action> {

    constructor(extensionPath: string) {
        super(extensionPath);
    }

    public get title(): string {
        return "Create pull request";
    }
    public get id(): string {
        return "createPullRequestScreen";
    }

    public async invalidate() {
        const state: RepoData[] = [];
        const repos = Container.bitbucketContext.getAllRepositores();
        for (let i = 0; i < repos.length; i++) {
            const r = repos[i];
            const [, repo] = await Promise.all([r.fetch(), RepositoriesApi.get(r.state.remotes[0])]);
            const mainbranch = repo.mainbranch ? repo.mainbranch!.name : undefined;
            await state.push({
                uri: r.rootUri.toString(),
                branches: await Promise.all(r.state.refs.filter(ref => ref.type === RefType.Head && ref.name).map(ref => r.getBranch(ref.name!))),
                mainbranch: mainbranch
            });
        }

        this.postMessage({type: 'createPullRequestData', repositories: state});
    }

    async createOrShow(): Promise<void> {
        await super.createOrShow();
        await this.invalidate();
    }

    protected async onMessageReceived(e: Action): Promise<boolean> {
        let handled = await super.onMessageReceived(e);

        if(!handled) {
            switch (e.action) {
                case 'checkoutCommand': {
                    handled = true;
                    this.checkout().catch((e: any) => {
                        Logger.error(new Error(`error checking out branch: ${e}`));
                        window.showErrorMessage('Branch checkout failed');
                    });
                    break;
                }
                case 'fetchDetails': {
                    if (isFetchDetails(e)) {
                        handled = true;
                        this.fetchDetails(e).catch((e: any) => {
                            Logger.error(new Error(`error fetching details: ${e}`));
                            window.showErrorMessage('Fetching branch details failed');
                        });
                        break;
                    }
                }
                case 'createPullRequest': {
                    if (isCreatePullRequest(e)) {
                        handled = true;
                        this.createPullRequest(e)
                            .then(result => this.postMessage({
                                type: 'createPullRequestResult',
                                url: result!
                            }))
                            .catch((e: any) => {
                                Logger.error(new Error(`error creating pull request: ${e}`));
                                window.showErrorMessage('Pull request creation failed');
                            });
                        break;
                    }
                }
            }
        }

        return handled;
    }

    private async checkout() {
        await commands.executeCommand('git.checkout');
    }

    private async fetchDetails(fetchDetailsAction: FetchDetails) {
        const {repoUri, sourceBranch, destinationBranch} = fetchDetailsAction;
        const remoteName = destinationBranch.upstream!.remote;
        const repo = Container.bitbucketContext.getRepository(Uri.parse(repoUri))!;
        const remote = repo.state.remotes.find(r => r.name === remoteName)!;

        const result = await RepositoriesApi.getCommitsForRefs(remote, sourceBranch.name!, destinationBranch.name!);
        this.postMessage({
            type: 'commitsResult',
            commits: result
        });
    }

    private async createPullRequest(createPullRequestAction: CreatePullRequest) {
        const {repoUri, title, summary, sourceBranch, destinationBranch} = createPullRequestAction;
        const remoteName = destinationBranch.upstream!.remote;
        const repo = Container.bitbucketContext.getRepository(Uri.parse(repoUri))!;
        const remote = repo.state.remotes.find(r => r.name === remoteName)!;

        let pr: Bitbucket.Schema.Pullrequest = {
            type: 'pullrequest',
            title: title,
            summary: {
                raw: summary
            },
            source: {
                branch: {
                    name: sourceBranch.name!
                }
            },
            destination: {
                branch: {
                    name: destinationBranch.name!
                }
            }
        };

        const result = await PullRequestApi.create({repository: repo, remote: remote, data: pr});
        return result.data.links!.html!.href;
    }
}
