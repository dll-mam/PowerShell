export interface Pipeline {
    build_number: number;
    created_on: string;
    creator_name?: string;
    creator_avatar?: string;
    state: PipelineState;
    uuid: string;
    target?: PipelineTarget;
    completed_on?: string;
    duration_in_seconds?: number;
}

export enum Status {
    Pending,
    InProgress,
    Stopped,
    Successful,
    Error,
    Failed,
    Unknown,
}

export interface PipelineState {
    name: string;
    type: string;
    result?: PipelineResult;
}

export interface PipelineResult {
    name: string;
    type: string;
}

export interface PipelineTarget {
    ref_name: string;
}

export interface PipelineStep {
    run_number: number;
    uuid: string;
    name?: string;
    started_on?: string;
    completed_on?: string;
    setup_commands: PipelineCommand[];
    script_commands: PipelineCommand[];
    teardown_commands: PipelineCommand[];
    duration_in_seconds: number;
    state: PipelineState;
}

export interface PipelineCommand {
    action?: string;
    command: string;
    name: string;
}

export function statusForState(state: PipelineState): Status {
    switch (state.type) {
        case "pipeline_state_completed":
        // fall through
        case "pipeline_step_state_completed":
            return statusForResult(state.result!);
        case "pipeline_state_in_progress":
        // fall through
        case "pipeline_step_state_in_progress":
            return Status.InProgress;
        case "pipeline_state_pending":
        // fall through
        case "pipeline_step_state_pending":
            return Status.Pending;
        default:
            return Status.Unknown;
    }
}

function statusForResult(result: PipelineResult): Status {
    switch (result.type) {
        case "pipeline_state_completed_successful":
        // fall through
        case "pipeline_step_state_completed_successful":
            return Status.Successful;
        case "pipeline_state_completed_error":
        // fall through
        case "pipeline_step_state_completed_error":
            return Status.Error;
        case "pipeline_state_completed_failed":
        // fall through
        case "pipeline_step_state_completed_failed":
            return Status.Failed;
        case "pipeline_state_completed_stopped":
        // fall through
        case "pipeline_step_state_completed_stopped":
            return Status.Stopped;
        default:
            return Status.Unknown;
    }
}
