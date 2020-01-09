import TurndownService from 'turndown';
import { v4 } from "uuid";
import vscode, { CommentThread, MarkdownString } from 'vscode';
import { BitbucketMentionsCompletionProvider } from '../../bitbucket/bbMentionsCompletionProvider';
import { clientForSite } from '../../bitbucket/bbUtils';
import { BitbucketSite, Comment, emptyTask, Task } from '../../bitbucket/model';
import { Commands } from '../../commands';
import { PullRequestNodeDataProvider } from '../pullRequestNodeDataProvider';
import { PRFileDiffQueryParams } from './pullRequestNode';

const turndownService = new TurndownService();  

turndownService.addRule('mention', {
    filter: function (node) {
        return node.classList.contains('ap-mention') || node.classList.contains('user-mention');
    },
    replacement: function (content, _, options) {
        return `${options.emDelimiter}${content}${options.emDelimiter}`;
    }
});
turndownService.addRule('highlightedCodeBlock', {
    filter: function (node) {
        return node.nodeName === 'DIV' && 
        node.classList.contains('codehilite') && 
        !!node.firstChild &&
        node.firstChild.nodeName === 'PRE';
    },
    replacement: function (_, node: any, options) {
      const className = node.className || '';
      const language = (className.match(/language-(\S+)/) || [null, ''])[1];
      return `${options.fence}${language}\n${node.firstChild.textContent}\n\n${options.fence}\n\n`;
    }
  });

interface PullRequestComment extends vscode.Comment {
    site: BitbucketSite;
    authorId: string;
    prCommentThreadId: string | undefined;
    parent?: vscode.CommentThread;
    prHref: string;
    prId: string;
    id: string;
    tasks: Task[];
    saveChangesContext: SaveContexts;
    temporaryTask?: PullRequestTask;
    temporaryReply?: PullRequestComment;
    isTemporary?: boolean;
    parentCommentId?: string;

    //This stores the content in the comment when 'edit' is clicked, so that the state can be restored if cancel is clicked
    editModeContent: MarkdownString | string; 
}

interface PullRequestTask extends vscode.Comment {
    site: BitbucketSite;
    prCommentThreadId: string | undefined;
    parent?: vscode.CommentThread;
    prHref: string;
    prId: string;
    task: Task;
    id: string;
    saveChangesContext: SaveContexts;
    editModeContent: MarkdownString | string;
    isTemporary?: boolean;
}

type EnhancedComment = PullRequestTask | PullRequestComment;

enum SaveContexts {
    EDITINGCOMMENT,
    EDITINGTASK,
    CREATINGTASK,
    CREATINGREPLY
}

function isPRTask(comment: vscode.Comment): comment is PullRequestTask{
    return !!(<PullRequestTask>comment).task;
}

function isPRComment(comment: vscode.Comment): comment is PullRequestComment{
    return !!(<PullRequestComment>comment).tasks;
}

// PullRequestCommentController is a comment controller for a given PR
export class PullRequestCommentController implements vscode.Disposable {

    private _commentController: vscode.CommentController = vscode.comments.createCommentController('bbpr', 'Bitbucket pullrequest comments');
    // map of comment threads keyed by pull request - Map<`pull request href`, Map<`comment id`, vscode.CommentThread>>
    private _commentsCache = new Map<string, Map<string, vscode.CommentThread>>();

    constructor(ctx: vscode.ExtensionContext) {
        ctx.subscriptions.push(
            vscode.languages.registerCompletionItemProvider({ scheme: 'comment' }, new BitbucketMentionsCompletionProvider(), '@'),

            //Invoked when a comment is written in the "reply" text box and is submitted
            vscode.commands.registerCommand(Commands.BitbucketAddComment, async (reply: vscode.CommentReply) => {
                await this.addComment(reply);
                const { prHref } = JSON.parse(reply.thread.uri.query) as PRFileDiffQueryParams;
                vscode.commands.executeCommand(Commands.RefreshPullRequestExplorerNode, vscode.Uri.parse(prHref));
            }),

            //Invoked when the trashcan icon is pressed on a comment; it deletes the comment
            vscode.commands.registerCommand(Commands.BitbucketDeleteComment, async (comment: PullRequestComment) => {
                await this.deleteComment(comment);
                vscode.commands.executeCommand(Commands.RefreshPullRequestExplorerNode, vscode.Uri.parse(comment.prHref));
            }),

            //Invoked when the "Cancel" button is pressed when creating a new comment or editing an existing one
            vscode.commands.registerCommand(Commands.BBPRCancelAction, async (comment: EnhancedComment) => {
                if(comment.saveChangesContext === SaveContexts.CREATINGTASK) {
                    await this.removeTemporaryCommentsAndTasks(comment as PullRequestTask);
                } else {
                    this.convertCommentToMode(comment, vscode.CommentMode.Preview);
                }
            }),

            //Invoked when the edit pen button is pressed; replaces the comment with a text window with 'save' and 'cancel' buttons.
            vscode.commands.registerCommand(Commands.BitbucketEditComment, (comment: PullRequestComment) => {
                this.editCommentClicked(comment);
            }),

            //Invoked when the 'Save' or 'Save Changes' buttons are pressed on a comment with a text body.
            //Creating a new comment, creating a new task, editing an existing comment, and editing an existing task all invoke this action when 'save' is pressed
            //saveChangesPressed() does different actions depending on the 'saveChangesContext' attribute
            vscode.commands.registerCommand(Commands.BBPRSaveAction, async (comment: PullRequestTask) => {
                await this.saveChangesPressed(comment);
            }),

            //Invoked when the trash can icon is pressed on a task; deletes the task
            vscode.commands.registerCommand(Commands.BitbucketDeleteTask, async (task: PullRequestTask) => {
                await this.deleteTask(task);
                vscode.commands.executeCommand(Commands.RefreshPullRequestExplorerNode, vscode.Uri.parse(task.prHref));
            }),

            //Adds a 'temporary' task (editable body of a task with a 'save changes' and 'cancel' button).
            vscode.commands.registerCommand(Commands.BitbucketAddTask, async (comment: PullRequestComment) => {
                await this.addTemporaryEntity(comment, SaveContexts.CREATINGTASK);
            }),

            //Adds a 'temporary' comment (editable body of a comment with a 'save changes' and 'cancel' button).
            vscode.commands.registerCommand(Commands.BitbucketAddReply, async (comment: PullRequestComment) => {
                await this.addTemporaryEntity(comment, SaveContexts.CREATINGREPLY);
            }),

            //Invoked when the edit pen icon is pressed on a task. Brings up a text window with 'save changes' and 'cancel' buttons to allow for modifying content.
            vscode.commands.registerCommand(Commands.BitbucketEditTask, async (task: PullRequestTask) => {
                this.editCommentClicked(task);
            }),

            //When a task is incomplete, it'll display an unchecked box icon. When pressed, this action is invoked.
            vscode.commands.registerCommand(Commands.BitbucketMarkTaskComplete, async (taskData: PullRequestTask) => {
                const newComments = await this.updateTask(taskData.parent!.comments, taskData, {isComplete: true});
                this.createOrUpdateThread(taskData.prCommentThreadId!, taskData.parent!.uri, taskData.parent!.range, newComments);
                vscode.commands.executeCommand(Commands.RefreshPullRequestExplorerNode, vscode.Uri.parse(taskData.prHref));
            }),

            //When a task is complete, it'll display a checked box icon. When pressed, this action is invoked.
            vscode.commands.registerCommand(Commands.BitbucketMarkTaskIncomplete, async (taskData: PullRequestTask) => {
                const newComments = await this.updateTask(taskData.parent!.comments, taskData, {isComplete: false});
                this.createOrUpdateThread(taskData.prCommentThreadId!, taskData.parent!.uri, taskData.parent!.range, newComments);
                vscode.commands.executeCommand(Commands.RefreshPullRequestExplorerNode, vscode.Uri.parse(taskData.prHref));
            }),
            vscode.commands.registerCommand(Commands.BitbucketToggleCommentsVisibility, (input: vscode.Uri) => {
                this.toggleCommentsVisibility(input);
            })
        );
        this._commentController.commentingRangeProvider = {
            provideCommentingRanges: (document: vscode.TextDocument, token: vscode.CancellationToken): vscode.Range[] | undefined => {
                if (document.uri.scheme !== PullRequestNodeDataProvider.SCHEME) {
                    return undefined;
                }
                const { site, lhs, addedLines, deletedLines, lineContextMap } = JSON.parse(document.uri.query) as PRFileDiffQueryParams;
                if (site.details.isCloud) {
                    return [new vscode.Range(0, 0, document.lineCount - 1, 0)];
                }

                let result: vscode.Range[] = [];

                const contextLines = lhs
                    ? Object.values(lineContextMap)
                    : Object.keys(lineContextMap).map(parseInt);

                new Set([
                    ...addedLines,
                    ...deletedLines,
                    ...contextLines
                ]).forEach(line => {
                    result.push(new vscode.Range(line - 1, 0, line - 1, 0));
                });

                return result;
            }
        };
    }

    async saveChangesPressed(comment: EnhancedComment) {
        if (comment.body === '') {
            return;
        }

        //This same button is used for saving comment edits, saving task edits, and saving a new task (and possibly in the future, saving a new comment)
        //Therefore, we must direct perform the correct action based on the situation...
        this.convertCommentToMode(comment, vscode.CommentMode.Preview, true);
        const commentThreadId = comment.prCommentThreadId;
        let comments: vscode.Comment[] = [];

        if(comment.saveChangesContext === SaveContexts.CREATINGTASK && isPRTask(comment)) {
            comments = await this.addTask(comment.parent!.comments, comment);
        } else if(comment.saveChangesContext === SaveContexts.CREATINGREPLY && isPRComment(comment)) {
            comments = await this.addReplyToComment(comment.parent!.comments, comment);
        } else if (comment.saveChangesContext === SaveContexts.EDITINGCOMMENT && isPRComment(comment)) {
            const bbApi = await clientForSite(comment.site);
            let newComment: Comment = await bbApi.pullrequests.editComment(comment.site, comment.prId, comment.body.toString(), comment.id);
            
            //The data returned by the comment API endpoint doesn't include task data, so we need to make sure we preserve that...
            newComment.tasks = comment.tasks;
            comments = await this.replaceEditedComment(comment.parent!.comments as EnhancedComment[], newComment);
        } else if (comment.saveChangesContext === SaveContexts.EDITINGTASK && isPRTask(comment)) {
            comments = await this.updateTask(comment.parent!.comments, comment, { content: comment.body.toString() });
        }  else {
            return; //This is a bug, so it's better to do nothing than to update the thread.
        }
        this.createOrUpdateThread(commentThreadId!, comment.parent!.uri, comment.parent!.range, comments);
        comment.parent!.dispose();
        vscode.commands.executeCommand(Commands.RefreshPullRequestExplorerNode, vscode.Uri.parse(comment.prHref));
    }

    async toggleCommentsVisibility(uri: vscode.Uri) {
        const { prHref } = JSON.parse(uri.query) as PRFileDiffQueryParams;

        if (!this._commentsCache.has(prHref)) {
            return;
        }

        const prCommentCache = this._commentsCache.get(prHref)!;
        prCommentCache.forEach(thread =>
            thread.collapsibleState = thread.collapsibleState === vscode.CommentThreadCollapsibleState.Collapsed
                ? vscode.CommentThreadCollapsibleState.Expanded
                : vscode.CommentThreadCollapsibleState.Collapsed);
    }

    async addTask(comments: readonly vscode.Comment[], taskData: PullRequestTask) {
        const bbApi = await clientForSite(taskData.site);
        const newTask = await bbApi.pullrequests.postTask(
            taskData.site, 
            taskData.prId, 
            taskData.body.toString(),
            taskData.task.commentId
        );

        return comments.map((comment: PullRequestComment) => {
            if(comment.id === newTask.commentId){
                return {
                    ...comment,
                    tasks: [newTask, ...comment.tasks],
                    temporaryTask: undefined
                } as PullRequestComment;
            } else {
                return {
                    ...comment
                } as PullRequestComment;
            } 
        });
    }

    async addReplyToComment(comments: readonly vscode.Comment[], commentData: PullRequestComment) {
        if(!commentData.parent) {
            return [];
        }

        // WHAT'S BETWEEN THESE COMMENT LINES SHOULD BE SIMPLIFIED AS IT'S REPEATED CODE
        const {path, lhs, addedLines, deletedLines, lineContextMap } = JSON.parse(commentData.parent.uri.query) as PRFileDiffQueryParams;
        const lineNumber = commentData.parent.range.start.line + 1;
        const inline = {
            from: lhs ? lineNumber : undefined,
            to: lhs ? undefined : lineNumber,
            path: path
        };

        let lineType: 'ADDED' | 'REMOVED' | undefined = undefined;
        if (inline.to && lineContextMap.hasOwnProperty(lineNumber)) {
            inline.to = lineContextMap[lineNumber];
        } else if (addedLines.includes(lineNumber)) {
            lineType = 'ADDED';
        } else if (deletedLines.includes(lineNumber)) {
            lineType = 'REMOVED';
        }
        //

        const bbApi = await clientForSite(commentData.site);
        const newComment = await bbApi.pullrequests.postComment(
            commentData.site, 
            commentData.prId, 
            commentData.body.toString(),
            commentData.parentCommentId,
            inline,
            lineType);

        let newComments: PullRequestComment[] = [];
        for(const comment of comments as PullRequestComment[]) {
            if(isPRComment(comment)) {
                comment.temporaryReply = undefined;
            }
            newComments.push(comment);
            if(comment.id === newComment.parentId){
                newComments.push(await this.createVSCodeComment(commentData.site, newComment.id, newComment, commentData.prHref, commentData.prId));
            }
        }
        return newComments;
    }

    async addComment(reply: vscode.CommentReply) {
        const { site, prHref, prId, path, lhs, addedLines, deletedLines, lineContextMap } = JSON.parse(reply.thread.uri.query) as PRFileDiffQueryParams;

        const commentThreadId = reply.thread.comments.length === 0 ? undefined : (reply.thread.comments[0] as PullRequestComment).prCommentThreadId;

        const lineNumber = reply.thread.range.start.line + 1;
        const inline = {
            from: lhs ? lineNumber : undefined,
            to: lhs ? undefined : lineNumber,
            path: path
        };

        // For Bitbucket Server, the line number on which the comment is added is not always the line on the file.
        // For added and removed lines, it matches the line number on the file.
        // But when contents of LHS and RHS match for a line, the line number of the LHS file must be sent.
        // (Effectively it is the leftmost line number appearing on the unified-diff in the browser)
        let lineType: 'ADDED' | 'REMOVED' | undefined = undefined;
        if (inline.to && lineContextMap.hasOwnProperty(lineNumber)) {
            inline.to = lineContextMap[lineNumber];
        } else if (addedLines.includes(lineNumber)) {
            lineType = 'ADDED';
        } else if (deletedLines.includes(lineNumber)) {
            lineType = 'REMOVED';
        }


        const bbApi = await clientForSite(site);
        const data = await bbApi.pullrequests.postComment(site, prId, reply.text, commentThreadId, inline, lineType);

        const comments = [
            ...reply.thread.comments,
            await this.createVSCodeComment(site, data.id!, data, prHref, prId)
        ];

        this.createOrUpdateThread(commentThreadId!, reply.thread.uri, reply.thread.range, comments);

        reply.thread.dispose();
    }

    private async removeTemporaryCommentsAndTasks(commentData: EnhancedComment) {
        if(!commentData.parent) {
            return;
        }

        let newComments = commentData.parent!.comments.map(comment => {
            if(isPRComment(comment)) {
                comment.temporaryTask = undefined;
                comment.temporaryReply = undefined;
            }
            return comment;
        });

        await this.createOrUpdateThread(commentData.prCommentThreadId!, commentData.parent!.uri, commentData.parent!.range, newComments);
    }

    private convertCommentToMode(commentData: EnhancedComment, mode: vscode.CommentMode, saveWasPressed?: boolean) {
        if (!commentData.parent) {
            return;
        }

        commentData.parent.comments = commentData.parent.comments.map(comment => {
            if (commentData.id === (comment as EnhancedComment).id) {
                comment.mode = mode;
                if(mode === vscode.CommentMode.Preview && !saveWasPressed){
                    comment.body = commentData.editModeContent;
                }
            }

            return comment;
        });
    }

    private storeCommentContentForEdit(commentData: EnhancedComment): EnhancedComment {
        if(!commentData.parent) {
            return commentData;
        }

        commentData.parent.comments = commentData.parent.comments.map(comment => {
            if (commentData.id === (comment as EnhancedComment).id) {
                (comment as EnhancedComment).editModeContent = comment.body;
            }

            return comment;
        });

        return commentData;
    }

    async addTemporaryEntity(commentData: PullRequestComment, actionContext: SaveContexts) {
        if (!commentData.parent) {
            return;
        }

        await this.removeTemporaryCommentsAndTasks(commentData);
        const UUID = v4(); //The UUID is used to uniquely identify the temporary comment so that actions can be taken on it later
        let newComments;
        if(actionContext === SaveContexts.CREATINGTASK) {
            // Create a temporary task for this comment
            newComments = commentData.parent.comments.map(comment => {
                if (commentData.id === (comment as EnhancedComment).id) {
                    const temporaryTask: PullRequestTask = {
                        body: "",
                        mode: vscode.CommentMode.Preview,
                        author: {name: "Creating a New Task"},
                        site: commentData.site,
                        prCommentThreadId: commentData.prCommentThreadId,
                        task: {...emptyTask, commentId: commentData.id},
                        id: UUID,
                        editModeContent: "",
                        prId: commentData.prId,
                        prHref: commentData.prHref,
                        saveChangesContext: SaveContexts.CREATINGTASK,
                        isTemporary: true
                    };
                    (comment as PullRequestComment).temporaryTask = temporaryTask;
                }
    
                return comment;
            });
        } else if (actionContext === SaveContexts.CREATINGREPLY) {
            // Create a temporary comment for this comment
            newComments = commentData.parent.comments.map(comment => {
                if (commentData.id === (comment as EnhancedComment).id) {
                    const temporaryComment: PullRequestComment = {
                        body: "",
                        authorId: v4(),
                        mode: vscode.CommentMode.Preview,
                        author: {name: `Replying to ${commentData.author.name}`},
                        site: commentData.site,
                        prCommentThreadId: commentData.prCommentThreadId,
                        tasks: [],
                        id: UUID,
                        editModeContent: "",
                        prId: commentData.prId,
                        prHref: commentData.prHref,
                        saveChangesContext: SaveContexts.CREATINGREPLY,
                        isTemporary: true,
                        parentCommentId: commentData.id
                    };
                    (comment as PullRequestComment).temporaryReply = temporaryComment;
                }
    
                return comment;
            });
        } else {
            return; //This ensures newComments is defined
        }
        
        

        let commentThread = await this.createOrUpdateThread(commentData.prCommentThreadId!, commentData.parent.uri, commentData.parent.range, newComments);

        //This delay is required because otherwise the temporary comment/task will not be rendered as being in edit mode. This is probably a VS Code bug related to 
        //an asynchronous action, but for now I don't see a better solution than this.
        setTimeout(() => {
            commentThread.comments = commentThread.comments.map(comment => {
                if (UUID === (comment as EnhancedComment).id) {
                    comment.mode = vscode.CommentMode.Editing;
                }
    
                return comment;
            });
        }, 100);
    }

    editCommentClicked(commentData: EnhancedComment) {
        commentData = this.storeCommentContentForEdit(commentData);
        this.convertCommentToMode(commentData, vscode.CommentMode.Editing);
    }

    private async replaceEditedComment(comments: EnhancedComment[], newComment: Comment | Task): Promise<vscode.Comment[]> {
        const newComments: EnhancedComment[] = await Promise.all(comments.map(async (comment: EnhancedComment) => {
            if (comment.id === newComment.id) {
                if(isPRTask(comment)){
                    return await this.createVSCodeCommentTask(comment.site, comment.id!, (newComment as Task), comment.prHref, comment.prId);
                } 
                return await this.createVSCodeComment(comment.site, comment.id!, (newComment as Comment), comment.prHref, comment.prId);
            }
            return comment;
        }));

        return newComments;
    }

    private async updateTask(comments: readonly vscode.Comment[], taskData: PullRequestTask, newTaskData: Partial<Task>): Promise<PullRequestComment[]> {
        const bbApi = await clientForSite(taskData.site);
        const newTask: Task = await bbApi.pullrequests.editTask(taskData.site, taskData.prId, { ...(taskData as PullRequestTask).task, ...newTaskData });
        return comments.map((comment: PullRequestComment) => {
            if(comment.id === newTask.commentId){
                return {
                    ...comment,
                    tasks: comment.tasks.map(task => {
                        if(task.id === newTask.id){
                            return newTask;
                        } else {
                            return task;
                        }
                    })
                } as PullRequestComment;
            } else {
                return {
                    ...comment
                } as PullRequestComment;
            } 
        });
    }

    async submitCommentEdit(commentData: EnhancedComment) {
        if (commentData.body === '') {
            return;
        }

        this.convertCommentToMode(commentData, vscode.CommentMode.Preview, true);
        const commentThreadId = commentData.prCommentThreadId;
        if (commentThreadId && commentData.parent) {
            let comments: vscode.Comment[];
            if(isPRComment(commentData)){
                const bbApi = await clientForSite(commentData.site);
                let newComment: Comment = await bbApi.pullrequests.editComment(commentData.site, commentData.prId, commentData.body.toString(), commentData.id);
                
                //The data returned by the comment API endpoint doesn't include task data, so we need to make sure we preserve that...
                newComment.tasks = commentData.tasks;
                comments = await this.replaceEditedComment(commentData.parent!.comments as EnhancedComment[], newComment);
            } else {
                //Replace the edited task in the associated comment's task list
                comments = await this.updateTask(commentData.parent!.comments, (commentData as PullRequestTask), { content: commentData.body.toString() });
            }
            
            this.createOrUpdateThread(commentThreadId!, commentData.parent!.uri, commentData.parent!.range, comments);
            commentData.parent!.dispose();
        }
    }

    async deleteComment(commentData: PullRequestComment) {
        const commentThreadId = commentData.prCommentThreadId;
        if (commentThreadId && commentData.parent) {
            const bbApi = await clientForSite(commentData.site);
            await bbApi.pullrequests.deleteComment(commentData.site, commentData.prId, commentData.id);

            let comments = commentData.parent.comments.filter((comment: PullRequestComment) => comment.id !== commentData.id);

            this.createOrUpdateThread(commentThreadId, commentData.parent.uri, commentData.parent.range, comments);
            commentData.parent.dispose();
        }
    }

    async deleteTask(taskData: PullRequestTask) {
        const commentThreadId = taskData.prCommentThreadId;
        if (commentThreadId && taskData.parent) {
            const bbApi = await clientForSite(taskData.site);
            await bbApi.pullrequests.deleteTask(taskData.site, taskData.prId, taskData.task);

            //Remove the deleted task from the list of tasks in the associated comment's task list
            let comments = taskData.parent.comments.map((comment: PullRequestComment) => {
                if(comment.id === taskData.task.commentId){
                    return {
                        ...comment,
                        tasks: comment.tasks.filter(task => task.id !== taskData.id)
                    } as PullRequestComment;
                } else {
                    return {
                        ...comment
                    } as PullRequestComment;
                } 
            });
            
            this.createOrUpdateThread(commentThreadId, taskData.parent.uri, taskData.parent.range, comments);
            taskData.parent.dispose();
        }
    }

    clearCommentCache(uri: vscode.Uri) {
        const { prHref } = JSON.parse(uri.query) as PRFileDiffQueryParams;

        if (!this._commentsCache.has(prHref)) {
            this._commentsCache.set(prHref, new Map());
        }
        const prCommentCache = this._commentsCache.get(prHref)!;
        prCommentCache.forEach(thread => thread.dispose());
    }

    provideComments(uri: vscode.Uri) {
        const { site, commentThreads, prHref, prId } = JSON.parse(uri.query) as PRFileDiffQueryParams;
        (commentThreads || [])
            .forEach(async (commentThread: Comment[]) => {
                let range = new vscode.Range(0, 0, 0, 0);
                if (commentThread[0].inline!.from) {
                    range = new vscode.Range(commentThread[0].inline!.from! - 1, 0, commentThread[0].inline!.from! - 1, 0);
                } else if (commentThread[0].inline!.to) {
                    range = new vscode.Range(commentThread[0].inline!.to! - 1, 0, commentThread[0].inline!.to! - 1, 0);
                }

                let comments: PullRequestComment[] = [];
                for (const comment of commentThread) {
                    comments.push(await this.createVSCodeComment(site, commentThread[0].id!, comment, prHref, prId));
                }

                if (comments.length > 0) {
                    this.createOrUpdateThread(commentThread[0].id!, uri, range, comments);
                }
            });
    }

    private async insertTasks(comments: PullRequestComment[]): Promise<vscode.Comment[]> {
        let commentsWithTasks = [];
        for(const comment of comments){
            commentsWithTasks.push(comment);
            for(const task of comment.tasks){
                commentsWithTasks.push(await this.createVSCodeCommentTask(comment.site, comment.prCommentThreadId!, task, comment.prHref, comment.prId));
            }
        }
        return commentsWithTasks;
    }

    private async insertTemporaryEntities(comments: EnhancedComment[]): Promise<vscode.Comment[]> {
        let commentsWithTemporaryEntities = [];
        for(const comment of comments){
            commentsWithTemporaryEntities.push(comment);
            if(isPRComment(comment)){
                if(comment.temporaryTask) {
                    commentsWithTemporaryEntities.push(comment.temporaryTask);
                }
                if(comment.temporaryReply) {
                    commentsWithTemporaryEntities.push(comment.temporaryReply);
                }
            }
        }
        return commentsWithTemporaryEntities;
    }

    private async removeTemporaryEntities(comments: EnhancedComment[]): Promise<vscode.Comment[]> {
        return comments.filter(comment => !comment.isTemporary);
    }

    private async removeTasks(comments: EnhancedComment[]): Promise<vscode.Comment[]> {
        return comments.filter(comment => isPRComment(comment));
    }    

    private async createOrUpdateThread(threadId: string, uri: vscode.Uri, range: vscode.Range, comments: vscode.Comment[]): Promise<CommentThread> {
        const { prHref } = JSON.parse(uri.query) as PRFileDiffQueryParams;

        if (!this._commentsCache.has(prHref)) {
            this._commentsCache.set(prHref, new Map());
        }
        const prCommentCache = this._commentsCache.get(prHref)!;

        if (prCommentCache.has(threadId)) {
            prCommentCache.get(threadId)!.dispose();
        }

        const commentsWithoutTemporaryEntities = await this.removeTemporaryEntities(comments as EnhancedComment[]);
        const commentsWithoutTasks = await this.removeTasks(commentsWithoutTemporaryEntities as EnhancedComment[]);
        const commentsWithTasks = await this.insertTasks(commentsWithoutTasks as PullRequestComment[]);
        const commentsWithTemporaryEntities = await this.insertTemporaryEntities(commentsWithTasks as PullRequestComment[]);

        const newThread = this._commentController.createCommentThread(uri, range, commentsWithTemporaryEntities);
        newThread.label = '';
        newThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        for (let comment of newThread.comments) {
            if((comment as PullRequestComment).id){
                (comment as PullRequestComment).parent = newThread;
            }
        }

        prCommentCache.set(threadId, newThread);

        return newThread;
    }

    private async createVSCodeCommentTask(site: BitbucketSite, parentCommentThreadId: string, task: Task, prHref: string, prId: string): Promise<PullRequestTask>{
        let contextValueList: string[] = [];
        if (task.editable) {
            contextValueList.push("canModifyTask");
        }
        if (task.deletable) {
            contextValueList.push("canRemoveTask");
        }
        if (task.isComplete) {
            contextValueList.push("markIncomplete");
        } else {
            contextValueList.push("markComplete");
        }

        const taskBody = task.isComplete ? 
            new vscode.MarkdownString(`~~${turndownService.turndown(task.content)}~~`) : 
            new vscode.MarkdownString(turndownService.turndown(task.content));
        return {
            site: site,
            prCommentThreadId: parentCommentThreadId,
            body: taskBody,
            contextValue: contextValueList.join(","),
            author: {
                name: task.isComplete ? 'Task (Complete)' : 'Task',
            },
            mode: vscode.CommentMode.Preview,
            prHref: prHref,
            prId: prId,
            task: task,
            id: task.id,
            saveChangesContext: SaveContexts.EDITINGTASK,
            editModeContent: ""
        };
    }

    private async createVSCodeComment(site: BitbucketSite, parentCommentThreadId: string, comment: Comment, prHref: string, prId: string): Promise<PullRequestComment> {
        let contextValueString = "";
        if (comment.deletable && comment.editable) {
            contextValueString = "canEdit,canDelete,canAddTask";
        } else if (comment.editable) {
            contextValueString = "canEdit,canAddTask";
        } else if (comment.deletable) {
            contextValueString = "canDelete,canAddTask";
        }

        return {
            site: site,
            prCommentThreadId: parentCommentThreadId,
            body: new vscode.MarkdownString(turndownService.turndown(comment.htmlContent)),
            author: {
                name: comment.user.displayName || 'Unknown user',
                iconPath: vscode.Uri.parse(comment.user.avatarUrl)
            },
            authorId: comment.user.accountId,
            contextValue: contextValueString,
            mode: vscode.CommentMode.Preview,
            prHref: prHref,
            prId: prId,
            id: comment.id,
            saveChangesContext: SaveContexts.EDITINGCOMMENT,
            tasks: comment.tasks,
            editModeContent: ""
        };
    }

    disposePR(prHref: string) {
        if (this._commentsCache.has(prHref)) {
            this._commentsCache.get(prHref)!.forEach(val => val.dispose());
            this._commentsCache.delete(prHref);
        }
    }

    dispose() {
        this._commentsCache.clear();
        this._commentController.dispose();
    }
}