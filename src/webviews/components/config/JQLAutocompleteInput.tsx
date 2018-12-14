import React, { PureComponent } from "react";
import FieldBase, { Label } from "@atlaskit/field-base";
import debounce from "lodash.debounce";
import jQuery from "jquery";
import { akColorG400, akColorR400 } from "@atlaskit/util-shared-styles";
import Input from "@atlaskit/input";
import DropList, { Group, Item } from "@atlaskit/droplist";
import CheckCircleIcon from "@atlaskit/icon/glyph/check-circle";
import CrossCircleIcon from "@atlaskit/icon/glyph/cross-circle";
var JQLAutocomplete = require("@deviniti/jql-autocomplete");
import styled from 'styled-components';

const JqlInvalidIcon = <CrossCircleIcon
  size="medium"
  primaryColor={akColorR400}
  label="JQL valid"
/>;

const JqlValidIcon = <CheckCircleIcon
  size="medium"
  primaryColor={akColorG400}
  label="JQL invalid"
/>;

const FieldBaseWrapper = styled.div`
  span {
        padding: 7px 6px;
  };
`;

export class JQLAutocompleteInput extends PureComponent<
  {
    maxHeight?: number;
    shouldFlip?: boolean;
    initialValue: string;
    inputValue?: string;
    label?: string;
    inputId: string;
    getSuggestionsRequest: (fieldName: string, fieldValue: string) => Promise<any>;
    getAutocompleteDataRequest: () => Promise<any>;
    validationRequest: (value: string) => Promise<any>;
    onChange: (event: any) => void
  },
  {
    jql: string;
    jqlError: string | null;
    isOpen: boolean;
    suggestions: string[];
    focusedItemIndex: number | undefined;
  }
> {
  private constructorData: any;
  private jql: any;
  private jqlTimer: NodeJS.Timer | undefined;
  // private textInput: string;
  private containerNode: any;

  state = {
    jql: this.props.initialValue,
    jqlError: null,
    isOpen: false,
    suggestions: [],
    focusedItemIndex: undefined
  };

  componentDidMount() {
    this.constructorData = {
      //API requires jquery... TODO change jql-autocomplete API
      input: jQuery(`#${this.props.inputId}`),
      render: this.setSuggestions,
      getSuggestions: debounce(
        (
          fieldName: string,
          onSuccess: (results: any) => {},
          fieldValue = ""
        ) => {
          this.props
            .getSuggestionsRequest(fieldName, fieldValue)
            .then((response: any) => {
              onSuccess(response.results);
            });
        },
        400
      )
    };
    this.jql = new JQLAutocomplete(this.constructorData);

    this.props.getAutocompleteDataRequest().then(response => {
      this.jql.passAutocompleteData(response);
    });

    this.validateWhenComponentDidMount(this.props.initialValue);
  }

  setSuggestions = (suggestions: string[]) => {
    this.setState({ suggestions: [...suggestions] });
  }

  render() {
    const { isOpen, suggestions } = this.state;
    const { maxHeight, shouldFlip } = this.props;
    const { jqlError } = this.state;
    const Icon = !jqlError ? JqlValidIcon : JqlInvalidIcon;
    return (
      <div
        style={{ width: "100%", cursor: "default" }}
        onKeyDown={this.handleKeyboardInteractions}
        ref={element => {
          this.containerNode = element;
        }}
      >
        <Label label={this.props.label} />

        <DropList
          isKeyboardInteractionDisabled
          shouldFitContainer
          isOpen={isOpen && suggestions.length > 0}
          onOpenChange={this.onOpenChange}
          maxHeight={maxHeight}
          shouldFlip={shouldFlip}
          trigger={
            <FieldBaseWrapper>
              <FieldBase
                isPaddingDisabled={true}
                isFitContainerWidthEnabled
              //  invalidMessage={jqlError}
              >
                {Icon}
                <Input
                  isEditing
                  defaultValue={this.props.initialValue}
                  onInput={this.handleInputChange}
                  autocomplete={"off"}
                  id={this.props.inputId}
                  style={{ paddingLeft: 8, cursor: "auto", marginTop: 8 }}
                  ref={(input: string) => {
                    // this.textInput = input;
                  }}
                />
              </FieldBase>
            </FieldBaseWrapper>
          }
        >
          <Group>{this.renderItems()}</Group>
        </DropList>
      </div>
    );
  }

  renderItems = () => {
    return this.state.suggestions.map((item: any, index: number) => {
      const createMarkup = function() {
        return { __html: item.text };
      };
      const ItemText = function() {
        return <span dangerouslySetInnerHTML={createMarkup()} />;
      };
      return (
        <Item
          onActivate={() => this.handleItemSelect(item)}
          isFocused={index === this.state.focusedItemIndex}
          key={item.text}
          type="option"
        >
          <ItemText />
        </Item>
      );
    });
  }

  handleKeyboardInteractions = (event: any) => {
    const isSelectOpen = this.state.isOpen;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!isSelectOpen) {
          this.onOpenChange({ event, isOpen: true });
        }
        this.focusNextItem();
        return true;
        break;
      case "ArrowUp":
        event.preventDefault();
        if (isSelectOpen) {
          this.focusPreviousItem();
        }
        return true;
        break;
      case "Enter":
        if (isSelectOpen) {
          event.preventDefault();
          if (this.state.focusedItemIndex !== undefined) {
            this.handleItemSelect(
              this.state.suggestions[this.state.focusedItemIndex!]
            );
          } else {
            this.onOpenChange({ event, isOpen: false });
          }
        }
        return true;
        break;
      case "Tab":
        this.onOpenChange({ event, isOpen: false });
        return true;
        break;
      default:
        return false;
    }
  }

  onOpenChange = (attrs: any) => {
    this.setState({
      focusedItemIndex: undefined,
      isOpen: attrs.isOpen
    });
  }

  focusNextItem = () => {
    const { focusedItemIndex, suggestions } = this.state;
    const nextItemIndex = this.getNextFocusable(
      focusedItemIndex!,
      suggestions.length
    );
    this.setState({
      focusedItemIndex: nextItemIndex
    });
    this.scrollToFocused(nextItemIndex);
  }

  focusPreviousItem = () => {
    const { focusedItemIndex, suggestions } = this.state;
    const nextItemIndex = this.getPrevFocusable(
      focusedItemIndex!,
      suggestions.length
    );
    this.setState({
      focusedItemIndex: nextItemIndex
    });
    this.scrollToFocused(nextItemIndex);
  }

  getNextFocusable = (indexItem: number, length: number) => {
    if (indexItem === undefined) {
      return 0;
    }
    return (indexItem + 1) % length;
  }

  handleItemSelect = (item: any) => {
    this.setState({
      focusedItemIndex: undefined,
      isOpen: false
    });
    if (item) {
      item.onClick();
    }
  }

  getPrevFocusable = (indexItem: number, length: number) => {
    if (indexItem === undefined) {
      return length - 1;
    }
    return (length + indexItem - 1) % length;
  }

  scrollToFocused = (index: number) => {
    const scrollable = this.containerNode.querySelector(
      '[data-role="droplistContent"]'
    );
    let item;

    if (scrollable && index !== undefined) {
      item = scrollable.querySelectorAll('[data-role="droplistItem"]')[index];
    }

    if (item && scrollable) {
      scrollable.scrollTop =
        item.offsetTop - scrollable.clientHeight + item.clientHeight;
    }
  }

  handleInputChange = (event: any) => {
    const { value } = event.target;

    if (value.trim() !== this.props.inputValue) {
      this.validateInput(event);
      this.onOpenChange({ event, isOpen: true });
      event.target.dataIndex = this.props['data-index'];
      this.props.onChange(event);
    }
  }

  validateRequest = (value: any | undefined) => {
    if (value) {
      this.jqlTimer = setTimeout(() => {
        this.props
          .validationRequest(value)
          .then((res: any) => {
            if (res.errorMessages) {
              this.setState({
                jqlError: JSON.stringify(res.errorMessages)
              });
            } else {
              this.setState({ jqlError: null });
            }
          });
      }, 500);
    } else {
      this.setState({ jqlError: null });
    }
  }

  validateInput = (event: any) => {
    if (this.jqlTimer) {
      clearTimeout(this.jqlTimer);
    }
    const jql = event.currentTarget.value;
    this.validateRequest(jql);
  }

  validateWhenComponentDidMount = (value: any) => {
    this.validateRequest(value);
  }
}
