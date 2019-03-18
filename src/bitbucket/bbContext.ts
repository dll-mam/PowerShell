import { Disposable, EventEmitter, Event, commands, Uri } from 'vscode';
import { Repository, API as GitApi } from "../typings/git";
import { Commands } from '../commands';
import { Container } from '../container';
import { PullRequestApi } from './pullRequests';
import { currentUserBitbucket } from '../commands/bitbucket/currentUser';
import { AuthProvider } from '../atlclients/authInfo';
import { BitbucketIssuesExplorer } from '../views/bbissues/bbIssuesExplorer';
import { PullRequestsExplorer } from '../views/pullrequest/pullRequestsExplorer';

// BitbucketContext stores the context (hosts, auth, current repo etc.)
// for all Bitbucket related actions.
export class BitbucketContext extends Disposable {
    private _onDidChangeBitbucketContext: EventEmitter<void> = new EventEmitter<void>();
    readonly onDidChangeBitbucketContext: Event<void> = this._onDidChangeBitbucketContext.event;

    private _gitApi: GitApi;
    private _repoMap: Map<string, Repository> = new Map();
    private _pullRequestsExplorer: PullRequestsExplorer;
    private _bitbucketIssuesExplorer: BitbucketIssuesExplorer;
    private _disposable: Disposable;

    constructor(gitApi: GitApi) {
        super(() => this.dispose());
        this._gitApi = gitApi;
        this._pullRequestsExplorer = new PullRequestsExplorer(this);
        this._bitbucketIssuesExplorer = new BitbucketIssuesExplorer(this);

        Container.context.subscriptions.push(
            Container.authManager.onDidAuthChange((e) => {
                if (e.provider === AuthProvider.BitbucketCloud) {
                    this._onDidChangeBitbucketContext.fire();
                }
            }),
            commands.registerCommand(Commands.CurrentUserBitbucket, currentUserBitbucket),
        );

        this._disposable = Disposable.from(
            this._gitApi.onDidOpenRepository(this.refreshRepos, this),
            this._gitApi.onDidCloseRepository(this.refreshRepos, this),
            this._pullRequestsExplorer,
            this._bitbucketIssuesExplorer
        );
    }

    public refreshRepos() {
        this._repoMap.clear();
        this.getAllRepositores().forEach(repo => this._repoMap.set(repo.rootUri.toString(), repo));
        this._onDidChangeBitbucketContext.fire();
    }

    public getAllRepositores(): Repository[] {
        return this._gitApi.repositories;
    }

    public isBitbucketRepo(repo: Repository): boolean {
        return PullRequestApi.getBitbucketRemotes(repo).length > 0;
    }

    public getBitbucketRepositores(): Repository[] {
        return this.getAllRepositores().filter(this.isBitbucketRepo);
    }

    public getRepository(repoUri: Uri): Repository | undefined {
        return this._repoMap.get(repoUri.toString());
    }

    dispose() {
        this.disposeForNow();
        this._disposable.dispose();
    }

    disposeForNow() {
        if (this._pullRequestsExplorer) {
            this._pullRequestsExplorer.dispose();
        }
        if (this._bitbucketIssuesExplorer) {
            this._bitbucketIssuesExplorer.dispose();
        }

        this._onDidChangeBitbucketContext.dispose();
    }
}
