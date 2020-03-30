import { InlineTextEditorList, SwitchWithLabel } from '@atlassianlabs/guipi-core-components';
import { Grid } from '@material-ui/core';
import React, { memo, useCallback, useContext, useEffect, useState } from 'react';
import { ConfigControllerContext } from '../configController';

type CreateTriggerEditorProps = {
    triggers: string[];
    disabled: boolean;
};

export const CreateTriggerEditor: React.FunctionComponent<CreateTriggerEditorProps> = memo(({ triggers, disabled }) => {
    const controller = useContext(ConfigControllerContext);
    const [changes, setChanges] = useState<{ [key: string]: any }>({});

    const handleEnableToggle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const changes = Object.create(null);
        changes['jira.todoIssues.enabled'] = e.target.checked;
        setChanges(changes);
    }, []);

    const handleOptionsChange = useCallback((newOptions: string[]) => {
        const changes = Object.create(null);
        changes['jira.todoIssues.triggers'] = newOptions;
        setChanges(changes);
    }, []);

    useEffect(() => {
        if (Object.keys(changes).length > 0) {
            controller.updateConfig(changes);
            setChanges({});
        }
    }, [changes, controller]);

    return (
        <Grid container direction="column" spacing={2}>
            <Grid item>
                <SwitchWithLabel
                    label="Enable prompt to create Jira issues for TODO style comments"
                    size="small"
                    color="primary"
                    id="jiraHoverEnabled"
                    checked={!disabled}
                    onChange={handleEnableToggle}
                />
            </Grid>
            <Grid item>
                <InlineTextEditorList
                    options={triggers}
                    addOptionButtonContent="Add Trigger"
                    disabled={disabled}
                    inputLabel="Trigger Text"
                    onChange={handleOptionsChange}
                />
            </Grid>
        </Grid>
    );
});